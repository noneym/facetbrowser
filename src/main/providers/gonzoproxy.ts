import type { ProviderAccount, ProviderCountry, ProviderGenerateOptions } from '@shared/cloud'
import type { ProxyConfig } from '@shared/types'
import type { ProviderAdapter } from './index'
import { parseProxyLine } from '../proxy/parse'

// GonzoProxy residential proxies. REST API: help.gonzoproxy.com/api
// (x-api-key header). Verified response shapes:
//   GET  /proxy-api/countries -> { countries: [{ country_code, country_name, isps[] }] }
//   GET  /proxy-api/states?country=US -> { states: ["Alabama", ...] }
//   POST /proxy-api/generate -> { success, proxies: ["login_c_US_s_x_ttl_24h:pass@connect.gonzoproxy.app:10000"] }
//   POST /list-sub-accounts -> { success, data: { sub_accounts: [...] } }
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
  const err = (data as { error?: string } | null)?.error
  if (!res.ok || err) throw new Error(`GonzoProxy: ${err || `HTTP ${res.status}`}`)
  return data as T
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return '-'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

// Documented username syntax, used when the account stores its own proxy login:
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
    { key: 'login', label: 'Proxy login', hint: 'Optional: a sub-user login; otherwise the API generator picks the account default', optional: true },
    { key: 'password', label: 'Proxy password', secret: true, optional: true }
  ],

  async balance(acc) {
    try {
      const r = await call<{ data?: { sub_accounts?: Array<{ proxy_login: string; sub_account_name: string; is_active: boolean; traffic_remaining: number; traffic_total: number }> } }>(acc, '/list-sub-accounts', 'POST', {})
      const subs = r.data?.sub_accounts || []
      const lines = subs.map((s) => ({ label: `${s.sub_account_name || s.proxy_login}${s.is_active ? '' : ' (inactive)'}`, value: `${fmtBytes(s.traffic_remaining)} left of ${fmtBytes(s.traffic_total)}` }))
      if (!lines.length) lines.push({ label: 'API', value: 'connected (no sub-accounts; traffic is shown in the dashboard)' })
      return { ok: true, lines }
    } catch (e) {
      return { ok: false, error: (e as Error).message, lines: [] }
    }
  },

  async countries(acc) {
    const r = await call<{ countries?: Array<{ country_code?: string; country_name?: string }> }>(acc, '/proxy-api/countries', 'GET')
    return (r.countries || [])
      .filter((c) => c.country_code)
      .map((c): ProviderCountry => ({ code: String(c.country_code), name: String(c.country_name || c.country_code) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async generate(acc, opts) {
    const count = Math.max(1, Math.min(100, opts.count))
    const body: Record<string, unknown> = { country: (opts.country || 'US').toUpperCase(), count, rotation: !opts.sticky }
    if (opts.state) body.state = opts.state
    if (opts.city) body.city = opts.city
    if (opts.sticky) { body.ttl = Math.max(1, Math.min(168, opts.ttlHours || 24)); body.ttl_unit = 'h' }
    if (acc.credentials.login) body.login = acc.credentials.login
    if (acc.credentials.password) body.password = acc.credentials.password
    try {
      const r = await call<{ proxies?: string[] }>(acc, '/proxy-api/generate', 'POST', body)
      const parsed = (r.proxies || []).map((s) => parseProxyLine(s, 'http')).filter((p): p is ProxyConfig => !!p).map((p) => ({ ...p, protocol: opts.protocol || 'http' }))
      if (parsed.length) return parsed
      throw new Error('GonzoProxy: generator returned no proxies')
    } catch (e) {
      // Fallback: build gateway usernames locally from a stored login/password.
      if (!acc.credentials.login || !acc.credentials.password) throw e
      const out: ProxyConfig[] = []
      for (let i = 0; i < count; i++) {
        const sid = Math.random().toString(36).slice(2, 10)
        out.push({ protocol: opts.protocol || 'http', host: GATEWAY, port: GATEWAY_PORT, username: buildUsername(acc.credentials.login, opts, sid), password: acc.credentials.password })
      }
      return out
    }
  }
}
