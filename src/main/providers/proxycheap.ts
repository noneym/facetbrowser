import type { ProviderAccount, ProviderBalance, ProviderCountry } from '@shared/cloud'
import type { ProviderAdapter, ProviderProxy } from './index'

// Proxy-Cheap (docs.proxy-cheap.com). Proxies are bought in the dashboard;
// the API lists them with their connection details, so this provider imports
// owned proxies instead of generating gateway logins. Auth: X-Api-Key and
// X-Api-Secret headers from app.proxy-cheap.com/api-keys.
//   GET /account/balance -> { balance }
//   GET /proxies -> [{ id, status, networkType, countryCode,
//        authentication: { username, password, whitelistedIps[] },
//        connection: { publicIp, connectIp, httpPort, httpsPort, socks5Port },
//        proxyType, expiresAt, metadata: { ispName } }]
const API = 'https://api.proxy-cheap.com'

interface PcProxy {
  id: number | string
  status?: string
  networkType?: string
  countryCode?: string
  authentication?: { username?: string | null; password?: string | null; whitelistedIps?: string[] }
  connection?: { publicIp?: string | null; connectIp?: string | null; httpPort?: number | string | null; httpsPort?: number | string | null; socks5Port?: number | string | null }
  proxyType?: string
  expiresAt?: string | null
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

const pretty = (s: string | undefined): string => (s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

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
      for (const p of proxies) byType.set(pretty(p.networkType) || 'Proxy', (byType.get(pretty(p.networkType) || 'Proxy') || 0) + 1)
      lines.push({ label: 'Active proxies', value: proxies.length ? [...byType].map(([k, n]) => `${n} ${k}`).join(', ') : '0' })
      const next = proxies.map((p) => (p.expiresAt ? Date.parse(p.expiresAt) : NaN)).filter(Number.isFinite).sort((a, b) => a - b)[0]
      if (next) lines.push({ label: 'Next expiry', value: new Date(next).toLocaleDateString() })
      return { ok: true, lines }
    } catch (e) {
      return { ok: false, error: (e as Error).message, lines: [] }
    }
  },

  // Only the countries the account owns proxies in.
  async countries(acc) {
    const proxies = await activeProxies(acc)
    const codes = [...new Set(proxies.map((p) => p.countryCode?.toUpperCase()).filter((c): c is string => !!c))]
    let names: Intl.DisplayNames | null = null
    try { names = new Intl.DisplayNames(['en'], { type: 'region' }) } catch { names = null }
    return codes.map((code): ProviderCountry => ({ code, name: names?.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name))
  },

  // Every active proxy that matches; the caller prefers ones not imported yet
  // and applies the count.
  async generate(acc, opts) {
    const want = opts.protocol === 'socks5' ? 'socks5' : 'http'
    const country = opts.country?.toUpperCase()
    const out: ProviderProxy[] = []
    for (const p of await activeProxies(acc)) {
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
