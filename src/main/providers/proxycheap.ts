import type { ProviderAccount, ProviderBalance, ProviderCountry, ProviderGenerateOptions, ProviderPlan } from '@shared/cloud'
import type { ProviderAdapter, ProviderProxy } from './index'

// Proxy-Cheap (docs.proxy-cheap.com). Proxies are bought in the dashboard;
// the API lists them with their connection details, so this provider imports
// owned proxies instead of generating gateway logins. Auth: X-Api-Key and
// X-Api-Secret headers from app.proxy-cheap.com/api-keys.
//   GET /account/balance -> { balance }
//   GET /proxies -> { proxies: [{ id, status, networkType, countryCode, serviceId,
//        authentication: { username, password, whitelistedIps[] },
//        connection: { publicIp, connectIp, httpPort, httpsPort, socks5Port },
//        proxyType, expiresAt, bandwidth: { total, used }, metadata: { ispName } }] }
//
// Rotating plans (serviceId rotating-residential) come back with a login but
// no host or port. Verified against a live account: they connect through
// thehub.proxy-cheap.com:8080 (HTTP and SOCKS5 on the same port), with the
// targeting appended to the password:
//   <pass>_country-de                      new IP per connection, in DE
//   <pass>_country-de_session-ab12cd34_ttl-30   same IP for 1-30 minutes
// Unknown keys or a ttl over 30 are answered with "internal error".
const API = 'https://api.proxy-cheap.com'
const GATEWAY = 'thehub.proxy-cheap.com'
const GATEWAY_PORT = 8080
const MAX_TTL_MIN = 30

interface PcProxy {
  id: number | string
  status?: string
  networkType?: string
  countryCode?: string | null
  serviceId?: string
  authentication?: { username?: string | null; password?: string | null; whitelistedIps?: string[] }
  connection?: { publicIp?: string | null; connectIp?: string | null; httpPort?: number | string | null; httpsPort?: number | string | null; socks5Port?: number | string | null }
  proxyType?: string
  expiresAt?: string | null
  bandwidth?: { total?: number | null; used?: number | null }
  metadata?: { ispName?: string | null }
}

async function call<T>(acc: ProviderAccount, path: string): Promise<T> {
  const key = acc.credentials.apiKey?.trim()
  const secret = acc.credentials.apiSecret?.trim()
  if (!key || !secret) throw new Error('Proxy-Cheap API key and secret are required')
  // A wrong key is answered with a 302 to the dashboard login, not a 401.
  const res = await fetch(`${API}${path}`, { redirect: 'manual', headers: { 'X-Api-Key': key, 'X-Api-Secret': secret, Accept: 'application/json' } })
  if (res.status >= 300 && res.status < 400) throw new Error('Proxy-Cheap: invalid API key or secret')
  const text = await res.text()
  let data: unknown = null
  try { data = JSON.parse(text) } catch { data = null }
  if (res.ok && data === null) throw new Error('Proxy-Cheap: unexpected response from the API')
  if (!res.ok) {
    const d = data as { message?: string; error?: string; detail?: string } | null
    const raw = d && typeof d === 'object' ? d.message || d.error || d.detail : ''
    const msg = raw === 'INVALID_CREDENTIALS' || (!raw && (res.status === 401 || res.status === 403)) ? 'invalid API key or secret' : raw || `HTTP ${res.status}`
    throw new Error(`Proxy-Cheap: ${msg}`)
  }
  return data as T
}

const port = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null
}

const pretty = (s: string | undefined): string => (s || '').toLowerCase().replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const isRotating = (p: PcProxy): boolean => /^rotating/i.test(p.serviceId || '') || /ROTAT/i.test(p.networkType || '') || !p.connection?.publicIp

const gb = (n: number | null | undefined): string => `${Number(n || 0).toFixed(2).replace(/\.?0+$/, '')} GB`

const planLabel = (p: PcProxy): string => `${pretty(p.serviceId || 'rotating')} #${p.id}${p.bandwidth?.total ? ` (${gb(p.bandwidth.used)} / ${gb(p.bandwidth.total)})` : ''}`

const sessionId = (): string => Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')

// One gateway login on a rotating plan, targeted by country and session.
function rotatingLogin(p: PcProxy, opts: ProviderGenerateOptions, protocol: 'http' | 'socks5'): ProviderProxy {
  const a = p.authentication || {}
  const c = p.connection || {}
  const cc = opts.country?.toLowerCase()
  let password = a.password || ''
  if (cc) password += `_country-${cc}`
  if (opts.sticky) password += `_session-${sessionId()}_ttl-${Math.max(1, Math.min(MAX_TTL_MIN, Math.round(opts.ttlMinutes || MAX_TTL_MIN)))}`
  const pt = (protocol === 'socks5' ? port(c.socks5Port) : port(c.httpPort) ?? port(c.httpsPort)) ?? GATEWAY_PORT
  const name = ['Proxy-Cheap', 'Rotating', cc?.toUpperCase() || 'Any', opts.sticky ? 'sticky' : ''].filter(Boolean).join(' ')
  return {
    protocol,
    host: c.connectIp || GATEWAY,
    port: pt,
    username: a.username || '',
    password,
    name,
    tags: ['proxycheap', 'Rotating', ...(cc ? [cc.toUpperCase()] : []), ...(opts.sticky ? ['sticky'] : [])]
  }
}

async function activeProxies(acc: ProviderAccount): Promise<PcProxy[]> {
  const list = await call<PcProxy[] | { proxies?: PcProxy[]; data?: PcProxy[] }>(acc, '/proxies')
  const arr = Array.isArray(list) ? list : list.proxies || list.data || []
  return arr.filter((p) => (p.status || 'ACTIVE').toUpperCase() === 'ACTIVE')
}

export const proxycheap: ProviderAdapter = {
  id: 'proxycheap',
  name: 'Proxy-Cheap',
  canGenerate: true,
  mode: 'import',
  fields: [
    { key: 'apiKey', label: 'API key', secret: true, hint: 'app.proxy-cheap.com > API keys' },
    { key: 'apiSecret', label: 'API secret', secret: true }
  ],

  async balance(acc): Promise<ProviderBalance> {
    try {
      const [b, proxies] = await Promise.all([call<{ balance?: number | string }>(acc, '/account/balance'), activeProxies(acc)])
      const lines = [{ label: 'Balance', value: `$${Number(b.balance ?? 0).toFixed(2)}` }]
      const byType = new Map<string, number>()
      const kind = (p: PcProxy): string => (isRotating(p) ? 'Rotating' : pretty(p.networkType) || 'Proxy')
      for (const p of proxies) byType.set(kind(p), (byType.get(kind(p)) || 0) + 1)
      lines.push({ label: 'Active proxies', value: proxies.length ? [...byType].map(([k, n]) => `${n} ${k}`).join(', ') : '0' })
      for (const p of proxies.filter(isRotating)) if (p.bandwidth?.total) lines.push({ label: `Rotating #${p.id}`, value: `${gb(p.bandwidth.used)} used of ${gb(p.bandwidth.total)}` })
      const next = proxies.map((p) => (p.expiresAt ? Date.parse(p.expiresAt) : NaN)).filter(Number.isFinite).sort((a, b) => a - b)[0]
      if (next) lines.push({ label: 'Next expiry', value: new Date(next).toLocaleDateString() })
      return { ok: true, lines }
    } catch (e) {
      return { ok: false, error: (e as Error).message, lines: [] }
    }
  },

  // Only the countries the account owns static proxies in; rotating plans
  // take any country code, which the dialog lists itself.
  async countries(acc) {
    const proxies = (await activeProxies(acc)).filter((p) => !isRotating(p))
    const codes = [...new Set(proxies.map((p) => p.countryCode?.toUpperCase()).filter((c): c is string => !!c))]
    let names: Intl.DisplayNames | null = null
    try { names = new Intl.DisplayNames(['en'], { type: 'region' }) } catch { names = null }
    return codes.map((code): ProviderCountry => ({ code, name: names?.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name))
  },

  async plans(acc): Promise<ProviderPlan[]> {
    return (await activeProxies(acc)).filter((p) => isRotating(p) && p.authentication?.username && p.authentication.password).map((p) => ({ id: String(p.id), label: planLabel(p) }))
  },

  // Owned pool: every active proxy that matches; the caller prefers ones not
  // imported yet and applies the count. Rotating pool: gateway logins.
  async generate(acc, opts) {
    const want = opts.protocol === 'socks5' ? 'socks5' : 'http'
    const country = opts.country?.toUpperCase()
    const all = await activeProxies(acc)
    if (opts.pool === 'rotating') {
      const plans = all.filter((p) => isRotating(p) && p.authentication?.username && p.authentication.password)
      const plan = plans.find((p) => String(p.id) === opts.plan) || plans[0]
      if (!plan) throw new Error('Proxy-Cheap: no active rotating plan on this account')
      // A rotating login is the same line every time; sticky ones get a session each.
      const n = opts.sticky ? Math.max(1, Math.min(100, opts.count)) : 1
      return Array.from({ length: n }, () => rotatingLogin(plan, opts, want))
    }
    const out: ProviderProxy[] = []
    for (const p of all) {
      if (isRotating(p)) continue
      if (country && p.countryCode?.toUpperCase() !== country) continue
      const c = p.connection || {}
      const host = c.connectIp || c.publicIp
      if (!host) continue
      const http = port(c.httpPort) ?? port(c.httpsPort)
      const socks = port(c.socks5Port)
      const protocol = want === 'socks5' ? (socks ? 'socks5' : 'http') : (http ? 'http' : 'socks5')
      const pt = protocol === 'socks5' ? socks : http
      if (!pt) continue
      const a = p.authentication || {}
      const cc = p.countryCode?.toUpperCase()
      out.push({
        protocol,
        host,
        port: pt,
        ...(a.username ? { username: a.username } : {}),
        ...(a.password ? { password: a.password } : {}),
        name: ['Proxy-Cheap', cc, c.publicIp || host].filter(Boolean).join(' '),
        tags: ['proxycheap', ...(cc ? [cc] : []), ...(p.networkType ? [pretty(p.networkType)] : [])]
      })
    }
    if (!out.length) throw new Error(country ? `Proxy-Cheap: no active proxies in ${country}` : 'Proxy-Cheap: no active proxies on this account')
    return out
  }
}
