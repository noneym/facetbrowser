import type { Anonymity, Grade, ProxyCheckResult, ProxyConfig } from '@shared/types'
import { agentFor, httpGet } from './agents'

export interface CheckOptions {
  contact?: string
  abuseKey?: string
  skipReportedForIntel?: boolean
  speedTest?: boolean
  speedTestBytes?: number
  onStage?: (stage: 'connecting' | 'enriching' | 'scoring') => void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Serialises getipintel calls (15/min free tier) across the whole app.
class ScoringGate {
  private lastCallAt = 0
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private minGapMs: number) {}
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(async () => {
      const elapsed = Date.now() - this.lastCallAt
      if (this.lastCallAt && elapsed < this.minGapMs) await sleep(this.minGapMs - elapsed)
      try {
        return await fn()
      } finally {
        this.lastCallAt = Date.now()
      }
    })
    this.tail = p.catch(() => {})
    return p
  }
}
const intelGate = new ScoringGate(4500)

let realIpCache: { ip: string; at: number } | null = null
export async function getRealIp(): Promise<string | null> {
  if (realIpCache && Date.now() - realIpCache.at < 10 * 60 * 1000) return realIpCache.ip
  for (const url of ['https://api.ipify.org?format=json', 'https://icanhazip.com']) {
    try {
      const res = await httpGet(url, { timeoutMs: 8000 })
      const ip = url.includes('ipify') ? JSON.parse(res.body).ip : res.body.trim()
      if (ip && net4or6(ip)) {
        realIpCache = { ip, at: Date.now() }
        return ip
      }
    } catch {
      /* next */
    }
  }
  return null
}

function net4or6(ip: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || /^[0-9a-f:]+$/i.test(ip)
}

const IP_PROBES = [
  { url: 'https://api.ipify.org?format=json', extract: (b: string) => JSON.parse(b).ip as string },
  { url: 'https://icanhazip.com', extract: (b: string) => b.trim() },
  { url: 'https://ifconfig.me/ip', extract: (b: string) => b.trim() }
]

async function detectIp(proxy: ProxyConfig): Promise<{ ip: string; samples: number[] }> {
  const agent = agentFor(proxy)
  let lastErr: Error | null = null
  for (const probe of IP_PROBES) {
    try {
      const first = await httpGet(probe.url, { agent, timeoutMs: 15000 })
      if (first.status !== 200) {
        lastErr = new Error(`HTTP ${first.status} from ${new URL(probe.url).hostname}`)
        continue
      }
      const ip = probe.extract(first.body)
      if (!ip || !net4or6(ip)) continue
      const samples = [first.ms]
      // two more samples for jitter; failures are ignored
      for (let i = 0; i < 2; i++) {
        try {
          const r = await httpGet(probe.url, { agent, timeoutMs: 15000 })
          if (r.status === 200) samples.push(r.ms)
        } catch {
          /* ignore */
        }
      }
      return { ip, samples }
    } catch (e) {
      lastErr = e as Error
    }
  }
  throw lastErr || new Error('IP could not be detected')
}

async function anonymityCheck(proxy: ProxyConfig, realIp: string | null): Promise<{ anonymity: Anonymity; leaked: string[] }> {
  try {
    const res = await httpGet('https://httpbin.org/get', { agent: agentFor(proxy), timeoutMs: 15000 })
    if (res.status !== 200) return { anonymity: 'unknown', leaked: [] }
    const data = JSON.parse(res.body) as { headers: Record<string, string>; origin: string }
    const h = Object.fromEntries(Object.entries(data.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
    const suspicious = ['via', 'x-forwarded-for', 'x-real-ip', 'forwarded', 'x-proxy-id', 'proxy-connection', 'x-forwarded-proto', 'client-ip']
    const leaked = suspicious.filter((k) => k in h)
    const all = `${data.origin} ${Object.values(h).join(' ')}`
    if (realIp && all.includes(realIp)) return { anonymity: 'transparent', leaked }
    if (leaked.length) return { anonymity: 'anonymous', leaked }
    return { anonymity: 'elite', leaked }
  } catch {
    return { anonymity: 'unknown', leaked: [] }
  }
}

interface IpApi {
  status?: string
  country?: string
  countryCode?: string
  regionName?: string
  city?: string
  isp?: string
  org?: string
  as?: string
  timezone?: string
  lat?: number
  lon?: number
  proxy?: boolean
  hosting?: boolean
  mobile?: boolean
}

async function enrich(ip: string): Promise<IpApi> {
  try {
    const fields = 'status,message,country,countryCode,regionName,city,isp,org,as,timezone,lat,lon,proxy,hosting,mobile'
    const res = await httpGet(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`, { timeoutMs: 10000 })
    if (res.status === 200) {
      const d = JSON.parse(res.body) as IpApi
      if (d.status === 'success') return d
    }
  } catch {
    /* ignore */
  }
  return {}
}

async function speedTest(proxy: ProxyConfig, bytes: number): Promise<number | undefined> {
  try {
    const res = await httpGet(`https://speed.cloudflare.com/__down?bytes=${bytes}`, { agent: agentFor(proxy), timeoutMs: 30000, maxBytes: bytes + 1024 })
    if (res.bytes > 0 && res.ms > 0) return Math.round((res.bytes * 8) / res.ms) // kbps
  } catch {
    /* ignore */
  }
  return undefined
}

async function getIpIntel(ip: string, contact: string): Promise<{ residential: number | null; combined: number | null; ok: boolean; error?: string }> {
  try {
    const res = await httpGet(
      `https://check.getipintel.net/check.php?ip=${encodeURIComponent(ip)}&contact=${encodeURIComponent(contact)}&format=json&oflags=r`,
      { timeoutMs: 30000 }
    )
    const raw = (res.body || '').trim()
    try {
      const d = JSON.parse(raw)
      if (d.status !== 'success') return { residential: null, combined: null, ok: false, error: `getipintel: ${d.message || raw}` }
      const combined = parseFloat(d.result)
      const residential = d.ResidentialProxy !== undefined ? parseFloat(d.ResidentialProxy) : NaN
      return {
        combined: Number.isFinite(combined) && combined >= 0 ? combined * 100 : null,
        residential: Number.isFinite(residential) && residential >= 0 ? residential * 100 : null,
        ok: true
      }
    } catch {
      const v = parseFloat(raw)
      return Number.isFinite(v) && v >= 0 ? { combined: v * 100, residential: null, ok: true } : { combined: null, residential: null, ok: false, error: `getipintel: ${raw}` }
    }
  } catch (e) {
    return { residential: null, combined: null, ok: false, error: `getipintel: ${(e as Error).message}` }
  }
}

async function getAbuse(ip: string, key: string): Promise<{ score?: number; reports?: number; lastReportedAt?: string | null; usageType?: string | null; isTor?: boolean; error?: string }> {
  try {
    const res = await httpGet(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=365&verbose`, {
      headers: { Key: key, Accept: 'application/json' },
      timeoutMs: 15000
    })
    if (res.status === 401 || res.status === 403) return { error: 'AbuseIPDB: invalid key' }
    if (res.status === 429) return { error: 'AbuseIPDB: daily limit reached' }
    if (res.status !== 200) return { error: `AbuseIPDB HTTP ${res.status}` }
    const parsed = JSON.parse(res.body)
    if (parsed.errors) return { error: parsed.errors.map((e: { detail: string }) => e.detail).join(', ') }
    const d = parsed.data || {}
    return { score: d.abuseConfidenceScore, reports: d.totalReports, lastReportedAt: d.lastReportedAt, usageType: d.usageType, isTor: !!d.isTor }
  } catch (e) {
    return { error: `AbuseIPDB: ${(e as Error).message}` }
  }
}

export function scoreResult(r: ProxyCheckResult): ProxyCheckResult {
  const issues: string[] = []
  let q = 100
  if (!r.ok) return { ...r, quality: 0, grade: 'F', verdict: 'Dead', issues: [r.error || 'Connection failed'] }

  const lat = r.latencyMs ?? 0
  if (lat > 3000) { q -= 30; issues.push('Very slow (>3s)') }
  else if (lat > 1500) { q -= 15; issues.push('Slow (>1.5s)') }
  else if (lat > 600) { q -= 5 }
  if ((r.jitterMs ?? 0) > 800) { q -= 5; issues.push('Unstable latency') }
  if (r.downloadKbps !== undefined && r.downloadKbps < 500) { q -= 10; issues.push('Low bandwidth') }

  if (r.anonymity === 'transparent') { q -= 35; issues.push('Transparent: real IP leaks') }
  else if (r.anonymity === 'anonymous') { q -= 10; issues.push('Proxy headers visible') }

  if (r.abuseIsTor) { q -= 40; issues.push('Tor exit node') }
  if (r.isProxy) { q -= 25; issues.push('Flagged as proxy/VPN (ip-api)') }
  if (r.isHosting) { q -= 20; issues.push('Datacenter / hosting range') }
  if (typeof r.abuseScore === 'number' && r.abuseScore > 0) { q -= Math.round(r.abuseScore * 0.4); issues.push(`AbuseIPDB confidence ${r.abuseScore}%`) }
  else if ((r.abuseReports ?? 0) > 0) { q -= 5; issues.push(`${r.abuseReports} abuse reports`) }
  if (typeof r.residentialScore === 'number' && r.residentialScore >= 30) { q -= 20; issues.push(`Residential proxy ${Math.round(r.residentialScore)}%`) }
  if (typeof r.combinedScore === 'number' && r.combinedScore >= 85) { q -= 25; issues.push('getipintel: likely VPN/proxy') }
  else if (typeof r.combinedScore === 'number' && r.combinedScore >= 50) { q -= 10 }
  if (typeof r.fraudScore === 'number' && r.fraudScore >= 85 && !r.combinedScore && !r.abuseScore) { q -= 25 }

  q = Math.max(0, Math.min(100, q))
  const grade: Grade = q >= 85 ? 'A' : q >= 70 ? 'B' : q >= 50 ? 'C' : q >= 30 ? 'D' : 'F'
  const verdict = grade === 'A' ? 'Clean' : grade === 'B' ? 'Good' : grade === 'C' ? 'Usable' : grade === 'D' ? 'Risky' : 'Burned'
  return { ...r, quality: q, grade, verdict, issues }
}

// Fast exit-IP geo lookup through the proxy (one request, no scoring); used
// at launch so timezone, language and location can follow the proxy even
// when it has never been fully checked.
export async function quickGeo(proxy: ProxyConfig): Promise<ProxyCheckResult | null> {
  try {
    const fields = 'status,query,country,countryCode,regionName,city,isp,org,as,timezone,lat,lon,proxy,hosting,mobile'
    const res = await httpGet(`http://ip-api.com/json/?fields=${fields}`, { agent: agentFor(proxy), timeoutMs: 8000 })
    if (res.status !== 200) return null
    const d = JSON.parse(res.body) as IpApi & { query?: string }
    if (d.status !== 'success' || !d.query) return null
    return {
      checkedAt: Date.now(),
      ok: true,
      ip: d.query,
      country: d.country,
      countryCode: d.countryCode,
      region: d.regionName,
      city: d.city,
      isp: d.isp,
      org: d.org,
      asn: d.as,
      timezone: d.timezone || '',
      lat: d.lat,
      lon: d.lon,
      isProxy: !!d.proxy,
      isHosting: !!d.hosting,
      isMobile: !!d.mobile
    } as ProxyCheckResult
  } catch {
    return null
  }
}

export async function checkProxy(proxy: ProxyConfig, opts: CheckOptions = {}): Promise<ProxyCheckResult> {
  const base: ProxyCheckResult = { checkedAt: Date.now(), ok: false }
  opts.onStage?.('connecting')
  let ip: string
  let samples: number[]
  try {
    ;({ ip, samples } = await detectIp(proxy))
  } catch (e) {
    return scoreResult({ ...base, error: (e as Error).message || String(e) })
  }
  const latencyMs = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
  const jitterMs = samples.length > 1 ? Math.round(Math.max(...samples) - Math.min(...samples)) : 0
  const r: ProxyCheckResult = { ...base, ok: true, ip, latencyMs, latencySamples: samples, jitterMs }

  opts.onStage?.('enriching')
  const realIp = await getRealIp()
  const [info, anon, speed] = await Promise.all([
    enrich(ip),
    anonymityCheck(proxy, realIp),
    opts.speedTest ? speedTest(proxy, opts.speedTestBytes || 500000) : Promise.resolve(undefined)
  ])
  Object.assign(r, {
    country: info.country || '',
    countryCode: info.countryCode || '',
    region: info.regionName || '',
    city: info.city || '',
    isp: info.isp || info.org || '',
    org: info.org || '',
    asn: info.as || '',
    timezone: info.timezone || '',
    lat: info.lat,
    lon: info.lon,
    isProxy: info.proxy === true,
    isHosting: info.hosting === true,
    isMobile: info.mobile === true,
    anonymity: anon.anonymity,
    leakedHeaders: anon.leaked,
    downloadKbps: speed
  })

  opts.onStage?.('scoring')
  const candidates: Array<{ provider: string; score: number }> = []
  if (opts.abuseKey) {
    const a = await getAbuse(ip, opts.abuseKey)
    r.abuseScore = typeof a.score === 'number' ? a.score : null
    r.abuseReports = typeof a.reports === 'number' ? a.reports : null
    r.abuseLastReportedAt = a.lastReportedAt ?? null
    r.abuseUsageType = a.usageType ?? null
    r.abuseIsTor = !!a.isTor
    if (typeof a.score === 'number') candidates.push({ provider: 'abuseipdb', score: a.score })
  }
  const hasAbuseSignal = (r.abuseScore ?? 0) > 0 || (r.abuseReports ?? 0) > 0 || !!r.abuseLastReportedAt
  if (opts.contact && !(opts.skipReportedForIntel && hasAbuseSignal)) {
    const g = await intelGate.run(() => getIpIntel(ip, opts.contact!))
    r.residentialScore = g.residential
    r.combinedScore = g.combined
    if (g.ok && g.residential !== null) candidates.push({ provider: 'getipintel', score: g.residential })
    else if (g.ok && g.combined !== null) candidates.push({ provider: 'getipintel', score: g.combined })
  }
  if (candidates.length) {
    const top = candidates.reduce((a, b) => (a.score > b.score ? a : b))
    r.fraudScore = top.score
    r.fraudProvider = top.provider
  } else {
    r.fraudScore = null
    r.fraudProvider = null
  }
  return scoreResult(r)
}

export async function pool<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let i = 0
  const worker = async (): Promise<void> => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker))
  return results
}
