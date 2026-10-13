import type { ProviderAccount, ProviderBalance, ProviderGenerateOptions } from '@shared/cloud'
import type { ProxyConfig } from '@shared/types'
import type { ProviderAdapter } from './index'

// 2Captcha residential proxies (per GB). Verified:
//   GET /proxy?key=            -> { status: "OK", data: { username, status, total_flow, use_flow, last_flow (MB), ip_white[] } }
//   GET /proxy/balance?key=    -> { status: "OK", balance, traffic }
//   GET /proxy/locations/countries?key= -> { status: "OK", data: [{ id, code: "de", title }], total }
// Gateway username parameters (tested): <login>-region-de-session-<id>-sessTime-<minutes>
const API = 'https://api.2captcha.com'
const DEFAULT_HOST = 'ap.proxy.2captcha.com'
const DEFAULT_PORT = '2334'

async function call<T>(acc: ProviderAccount, path: string, params: Record<string, string> = {}): Promise<T> {
  const key = acc.credentials.apiKey
  if (!key) throw new Error('2Captcha API key missing')
  const q = new URLSearchParams({ key, ...params })
  const res = await fetch(`${API}${path}?${q}`)
  const data = (await res.json().catch(() => null)) as { status?: string | number; errorDescription?: string; error?: string } | null
  const ok = data && (data.status === 'OK' || data.status === 1)
  if (!res.ok || !ok) throw new Error(`2Captcha: ${data?.errorDescription || data?.error || (typeof data?.status === 'string' ? data.status : `HTTP ${res.status}`)}`)
  return data as T
}

const mb = (v: unknown): string => (typeof v === 'number' ? (v >= 1024 ? `${(v / 1024).toFixed(2)} GB` : `${v.toFixed(0)} MB`) : '-')

export const twocaptcha: ProviderAdapter = {
  id: '2captcha',
  name: '2Captcha Proxy',
  canGenerate: true,
  fields: [
    { key: 'apiKey', label: 'API key', secret: true, hint: '2captcha.com > account settings' },
    { key: 'username', label: 'Proxy login', hint: 'From 2captcha.com/proxy, e.g. uce...-zone-custom' },
    { key: 'password', label: 'Proxy password', secret: true },
    { key: 'host', label: 'Gateway host', hint: `Default ${DEFAULT_HOST}`, optional: true },
    { key: 'port', label: 'Gateway port', hint: `Default ${DEFAULT_PORT}`, optional: true },
    { key: 'protocol', label: 'Protocol (http or socks5)', optional: true }
  ],

  async balance(acc): Promise<ProviderBalance> {
    try {
      const [b, info] = await Promise.all([
        call<{ balance?: number; traffic?: number }>(acc, '/proxy/balance'),
        call<{ data?: { username?: string; status?: number; total_flow?: number; use_flow?: number; last_flow?: number } }>(acc, '/proxy').catch(() => null)
      ])
      const lines = [{ label: 'Balance', value: `$${Number(b.balance ?? 0).toFixed(2)}` }]
      const d = info?.data
      if (d) {
        lines.push({ label: 'Traffic left', value: mb(d.last_flow) })
        lines.push({ label: 'Traffic used', value: `${mb(d.use_flow)} of ${mb(d.total_flow)}` })
        if (d.status !== undefined) lines.push({ label: 'Status', value: d.status === 1 ? 'active' : String(d.status) })
      } else if (typeof b.traffic === 'number') lines.push({ label: 'Traffic left', value: mb(b.traffic) })
      return { ok: true, lines }
    } catch (e) {
      return { ok: false, error: (e as Error).message, lines: [] }
    }
  },

  async countries(acc) {
    const r = await call<{ data?: Array<{ id: number; code: string; title: string }> }>(acc, '/proxy/locations/countries')
    return (r.data || []).map((c) => ({ code: c.code.toUpperCase(), name: c.title })).sort((a, b) => a.name.localeCompare(b.name))
  },

  async generate(acc, opts: ProviderGenerateOptions) {
    const { username, password } = acc.credentials
    if (!username || !password) throw new Error('2Captcha: store the proxy login and password from 2captcha.com/proxy first')
    const host = acc.credentials.host || DEFAULT_HOST
    const port = parseInt(acc.credentials.port || DEFAULT_PORT, 10)
    const protocol = (acc.credentials.protocol || 'http').toLowerCase() === 'socks5' ? 'socks5' : 'http'
    const base = username.replace(/-region-.*$/i, '').replace(/-session-.*$/i, '')
    const out: ProxyConfig[] = []
    for (let i = 0; i < Math.max(1, Math.min(100, opts.count)); i++) {
      const parts = [base]
      if (opts.country) parts.push(`region-${opts.country.toLowerCase()}`)
      if (opts.sticky) {
        parts.push(`session-${Math.random().toString(36).slice(2, 10)}`)
        parts.push(`sessTime-${Math.max(1, Math.min(120, Math.round((opts.ttlHours || 1) * 60)))}`)
      }
      out.push({ protocol, host, port, username: parts.join('-'), password })
    }
    return out
  }
}
