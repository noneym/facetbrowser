import type { ProviderAccount, ProviderBalance, ProviderCountry, ProviderGenerateOptions } from '@shared/cloud'
import type { ProxyConfig } from '@shared/types'
import type { ProviderAdapter } from './index'

// 2Captcha residential proxies (per GB). The API (2captcha.com/proxy/api)
// exposes balance, traffic and locations but never the proxy password, so the
// gateway credentials from the dashboard generator are stored once and reused.
const API = 'https://api.2captcha.com'

async function call<T>(acc: ProviderAccount, path: string, params: Record<string, string> = {}): Promise<T> {
  const key = acc.credentials.apiKey
  if (!key) throw new Error('2Captcha API key missing')
  const q = new URLSearchParams({ key, ...params })
  const res = await fetch(`${API}${path}?${q}`)
  const data = (await res.json().catch(() => null)) as { status?: number; data?: unknown; error?: string; errorDescription?: string; balance?: number } | null
  if (!res.ok || !data || (data.status !== undefined && data.status !== 1)) {
    throw new Error(`2Captcha: ${data?.errorDescription || data?.error || `HTTP ${res.status}`}`)
  }
  return data as T
}

export const twocaptcha: ProviderAdapter = {
  id: '2captcha',
  name: '2Captcha Proxy',
  canGenerate: true,
  fields: [
    { key: 'apiKey', label: 'API key', secret: true, hint: '2captcha.com account settings' },
    { key: 'host', label: 'Gateway host', hint: 'From the proxy generator on 2captcha.com/proxy' },
    { key: 'port', label: 'Gateway port' },
    { key: 'username', label: 'Proxy login' },
    { key: 'password', label: 'Proxy password', secret: true },
    { key: 'protocol', label: 'Protocol (http or socks5)', optional: true }
  ],

  async balance(acc): Promise<ProviderBalance> {
    try {
      const [b, info] = await Promise.all([
        call<{ balance?: number }>(acc, '/proxy/balance'),
        call<{ data?: { username?: string; status?: string; total_flow?: number; use_flow?: number; last_flow?: number } }>(acc, '/proxy').catch(() => null)
      ])
      const lines = [{ label: 'Balance', value: `$${Number(b.balance ?? 0).toFixed(2)}` }]
      const d = info?.data
      if (d) {
        if (d.username) lines.push({ label: 'Proxy user', value: d.username })
        if (d.status) lines.push({ label: 'Status', value: String(d.status) })
        if (d.last_flow !== undefined) lines.push({ label: 'Traffic left', value: String(d.last_flow) })
        if (d.use_flow !== undefined) lines.push({ label: 'Traffic used', value: String(d.use_flow) })
      }
      return { ok: true, lines }
    } catch (e) {
      return { ok: false, error: (e as Error).message, lines: [] }
    }
  },

  async countries(acc) {
    const r = await call<{ data?: Array<{ id: number; code: string; title: string }> }>(acc, '/proxy/locations/countries', { page: '1' })
    return (r.data || []).map((c) => ({ code: c.code, name: c.title }))
  },

  // The dashboard generator already encodes geo and session length in the
  // credentials, so "generating" means handing out the stored gateway entry.
  async generate(acc, opts: ProviderGenerateOptions) {
    const { host, port, username, password } = acc.credentials
    if (!host || !port || !username || !password) throw new Error('2Captcha: store the gateway host, port, login and password from the proxy generator first')
    const protocol = (acc.credentials.protocol || 'http').toLowerCase() === 'socks5' ? 'socks5' : 'http'
    const out: ProxyConfig[] = []
    for (let i = 0; i < Math.max(1, Math.min(50, opts.count)); i++) out.push({ protocol, host, port: parseInt(port, 10), username, password })
    return out
  }
}
