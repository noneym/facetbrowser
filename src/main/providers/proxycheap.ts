import type { ProviderAccount, ProviderBalance, ProviderCountry, ProviderGenerateOptions } from '@shared/cloud'
import type { ProxyConfig } from '@shared/types'
import type { ProviderAdapter, ProviderProxy } from './index'
import { parseProxyLine } from '../proxy/parse'

// Proxy-Cheap (docs.proxy-cheap.com). Proxies are bought in the dashboard;
// the API lists them with their connection details, so this provider imports
// owned proxies instead of generating gateway logins. Auth: X-Api-Key and
// X-Api-Secret headers from app.proxy-cheap.com/api-keys.
//   GET /account/balance -> { balance }
//   GET /proxies -> [{ id, status, networkType, countryCode,
//        authentication: { username, password, whitelistedIps[] },
//        connection: { publicIp, connectIp, httpPort, httpsPort, socks5Port },
//        proxyType, expiresAt, metadata: { ispName } }]
//
// Rotating plans (networkType ROTATING_RESIDENTIAL / ROTATING_MOBILE) have no
// public IP: they are gateway logins whose targeting lives in the username,
// as the dashboard's Setup Credentials generator builds them:
//   pcXXXXXXXX-res-<cc|any>[-session-<id>]:PC_xxx@proxy-us.proxy-cheap.com:5959 (SOCKS5 9595)
// Older plans use proxy.proxy-cheap.com:31112 with the targeting in the
// password: <pass>_country-<cc>[_session-<id>_lifetime-30m].
const API = 'https://api.proxy-cheap.com'
const GATEWAY = 'proxy-us.proxy-cheap.com'
const GATEWAY_HTTP = 5959
const GATEWAY_SOCKS = 9595

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

const isRotating = (p: PcProxy): boolean => /ROTAT/i.test(`${p.networkType || ''} ${p.proxyType || ''}`) || !p.connection?.publicIp

const isIp = (h: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')

const sessionId = (): string => Math.random().toString(36).slice(2, 10)

// The gateway login of a rotating plan: from the API, else from the login the
// user pasted from Setup Credentials into the account.
function gatewayLogin(acc: ProviderAccount, p: PcProxy | null): ProxyConfig | null {
  const a = p?.authentication || {}
  const c = p?.connection || {}
  if (a.username && a.password) {
    // pc-prefixed logins belong to the current gateway; others to the legacy one.
    const legacy = !/^pc/i.test(a.username)
    const host = c.connectIp && !isIp(c.connectIp) ? c.connectIp : legacy ? 'proxy.proxy-cheap.com' : GATEWAY
    return { protocol: 'http', host, port: port(c.httpPort) ?? (legacy ? 31112 : GATEWAY_HTTP), username: a.username, password: a.password }
  }
  const pasted = acc.credentials.rotatingLogin?.trim()
  return pasted ? parseProxyLine(pasted, 'http') : null
}

// Applies country and session to a gateway login; the base login may come
// with targeting already in it, which is replaced.
function target(login: ProxyConfig, p: PcProxy | null, opts: ProviderGenerateOptions, protocol: 'http' | 'socks5'): ProviderProxy {
  const cc = opts.country?.toLowerCase()
  const c = p?.connection || {}
  const legacy = login.port === 31112 || /^proxy\.proxy-cheap\.com$/i.test(login.host)
  let { username = '', password = '' } = login
  let pt = login.port
  if (legacy) {
    password = password.replace(/_(country|session|lifetime)-[^_]*/g, '')
    if (cc) password += `_country-${cc}`
    if (opts.sticky) password += `_session-${sessionId()}_lifetime-30m`
    // The legacy gateway has no documented SOCKS5 port unless the API gives one.
    const socks = port(c.socks5Port)
    if (protocol === 'socks5' && socks) pt = socks
    else if (protocol === 'socks5' && login.protocol !== 'socks5') protocol = 'http'
  } else {
    const m = username.match(/^(.+?)-(res|mob|isp)(?:-|$)/)
    const product = m ? m[2] : /MOBILE/i.test(p?.networkType || '') ? 'mob' : 'res'
    username = `${m ? m[1] : username}-${product}-${cc || 'any'}${opts.sticky ? `-session-${Math.floor(1e7 + Math.random() * 9e7)}` : ''}`
    if (login.protocol !== protocol) pt = protocol === 'socks5' ? port(c.socks5Port) ?? GATEWAY_SOCKS : port(c.httpPort) ?? GATEWAY_HTTP
  }
  const cc2 = cc?.toUpperCase()
  return {
    protocol,
    host: login.host,
    port: pt,
    username,
    password,
    name: ['Proxy-Cheap', 'Rotating', cc2 || 'Any', opts.sticky ? 'sticky' : ''].filter(Boolean).join(' '),
    tags: ['proxycheap', 'Rotating', ...(cc2 ? [cc2] : []), ...(opts.sticky ? ['sticky'] : [])]
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
    { key: 'apiSecret', label: 'API secret', secret: true },
    { key: 'rotatingLogin', label: 'Rotating login', secret: true, optional: true, hint: 'Only if the API gives no login for a rotating plan: one line from Setup Credentials (user:pass@host:port)' }
  ],
  rotatingPool: true,

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

  // Only the countries the account owns static proxies in; rotating plans
  // take any country code.
  async countries(acc) {
    const proxies = (await activeProxies(acc)).filter((p) => !isRotating(p))
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
    const all = await activeProxies(acc)
    if (opts.pool === 'rotating') {
      const plans = all.filter(isRotating)
      const plan = plans.find((p) => gatewayLogin(acc, p)) || null
      const login = gatewayLogin(acc, plan)
      if (!login) {
        throw new Error(plans.length
          ? 'Proxy-Cheap: the API gives no login for the rotating plan; paste one line from Setup Credentials into the Rotating login field of this account'
          : 'Proxy-Cheap: no active rotating plan on this account')
      }
      // A rotating login is the same line every time; sticky ones get a session each.
      const n = opts.sticky ? Math.max(1, Math.min(100, opts.count)) : 1
      return Array.from({ length: n }, () => target(login, plan, opts, want))
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
