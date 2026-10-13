import type { ProviderAccount, ProviderBalance, ProviderCountry, ProviderGenerateOptions } from '@shared/cloud'
import type { ProxyConfig } from '@shared/types'
import type { ProviderAdapter } from './index'
import { parseProxyLine } from '../proxy/parse'

// GonzoProxy residential proxies. REST API documented at
// help.gonzoproxy.com/api/gonzoproxy-api-documentation (x-api-key header).
const API = 'https://api.gonzoproxy.app/functions/v1'
const GATEWAY = 'connect.gonzoproxy.app'
const GATEWAY_PORT = 10000

async function call<T>(acc: ProviderAccount, path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const key = acc.credentials.apiKey
  if (!key) throw new Error('GonzoProxy API key missing')
  const res = await fetch(`${API}${path}`, { method, headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let data: unknown = null
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) {
    const err = (data as { error?: string } | null)?.error || `HTTP ${res.status}`
    throw new Error(`GonzoProxy: ${err}`)
  }
  return data as T
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return '-'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

// Builds a gateway username from the documented segment syntax:
//   <login>_c_US_sd_443_city_Los-Angeles_s_<session>_ttl_72h
function buildUsername(login: string, opts: ProviderGenerateOptions, sessionId: string): string {
  const parts = [login]
  if (opts.country) parts.push(`c_${opts.country.toUpperCase()}`)
  if (opts.state) parts.push(`sd_${opts.state}`)
  if (opts.city) parts.push(`city_${opts.city.replace(/\s+/g, '-')}`)
  if (opts.sticky) {
    parts.push(`s_${sessionId}`)
    parts.push(`ttl_${Math.max(1, Math.min(168, opts.ttlHours || 24))}h`)
  }
  return parts.join('_')
}

export const gonzoproxy: ProviderAdapter = {
  id: 'gonzoproxy',
  name: 'GonzoProxy',
  canGenerate: true,
  fields: [
    { key: 'apiKey', label: 'API key', secret: true, hint: 'dashboard.gonzoproxy.com > Settings > API Keys' },
    { key: 'login', label: 'Proxy login', hint: 'From Proxy Setup or a sub-user (used to build gateway usernames)', optional: true },
    { key: 'password', label: 'Proxy password', secret: true, optional: true }
  ],

  async balance(acc) {
    try {
      const r = await call<{ data?: { sub_accounts?: Array<{ proxy_login: string; sub_account_name: string; is_active: boolean; traffic_remaining: number; traffic_total: number }> } }>(acc, '/list-sub-accounts', 'POST', {})
      const subs = r.data?.sub_accounts || []
      const lines = subs.map((s) => ({ label: `${s.sub_account_name || s.proxy_login}${s.is_active ? '' : ' (inactive)'}`, value: `${fmtBytes(s.traffic_remaining)} left of ${fmtBytes(s.traffic_total)}` }))
      if (!lines.length) lines.push({ label: 'Sub-accounts', value: 'none' })
      return { ok: true, lines }
    } catch (e) {
      return { ok: false, error: (e as Error).message, lines: [] }
    }
  },

  async countries(acc) {
    const r = await call<{ countries?: Array<{ code?: string; name?: string } | string> }>(acc, '/proxy-api/countries', 'GET')
    const list = (r.countries || []).map((c) => (typeof c === 'string' ? { code: c, name: c } : { code: String(c.code || c.name), name: String(c.name || c.code) }))
    return list.filter((c): c is ProviderCountry => !!c.code)
  },

  async generate(acc, opts) {
    const count = Math.max(1, Math.min(100, opts.count))
    // Prefer the official generator; it returns ready-to-use proxy strings.
    try {
      const body: Record<string, unknown> = { country: (opts.country || 'US').toUpperCase(), count, rotation: !opts.sticky, format: 'host:port:user:pass' }
      if (opts.state) body.state = opts.state
      if (opts.city) body.city = opts.city
      if (opts.sticky) { body.ttl = Math.max(1, Math.min(168, opts.ttlHours || 24)); body.ttl_unit = 'h' }
      if (acc.credentials.login) body.login = acc.credentials.login
      if (acc.credentials.password) body.password = acc.credentials.password
      const r = await call<unknown>(acc, '/proxy-api/generate', 'POST', body)
      const strings = extractStrings(r)
      const parsed = strings.map((s) => parseProxyLine(s, 'http')).filter((p): p is ProxyConfig => !!p)
      if (parsed.length) return parsed
    } catch (e) {
      if (!acc.credentials.login || !acc.credentials.password) throw e
    }
    // Fallback: build gateway usernames locally from the stored login/password.
    if (!acc.credentials.login || !acc.credentials.password) throw new Error('GonzoProxy: generator returned nothing and no proxy login/password is stored')
    const out: ProxyConfig[] = []
    for (let i = 0; i < count; i++) {
      const sid = Math.random().toString(36).slice(2, 10)
      out.push({ protocol: 'http', host: GATEWAY, port: GATEWAY_PORT, username: buildUsername(acc.credentials.login, opts, sid), password: acc.credentials.password })
    }
    return out
  }
}

function extractStrings(v: unknown): string[] {
  if (typeof v === 'string') return v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === 'string' ? [x] : extractStrings(x)))
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['proxies', 'data', 'result', 'list']) if (k in o) return extractStrings(o[k])
    if ('host' in o && 'port' in o) return [`${o.host}:${o.port}${o.user || o.username ? `:${o.user || o.username}:${o.pass || o.password || ''}` : ''}`]
  }
  return []
}
