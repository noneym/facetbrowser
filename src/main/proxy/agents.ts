import http from 'http'
import https from 'https'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { ProxyConfig } from '@shared/types'
import { proxyToUrl } from './parse'

export function agentFor(proxy: ProxyConfig | null): http.Agent | undefined {
  if (!proxy) return undefined
  const url = proxyToUrl(proxy)
  if (proxy.protocol === 'socks4' || proxy.protocol === 'socks5') return new SocksProxyAgent(url, { timeout: 15000 })
  // HttpsProxyAgent tunnels any target (http or https) through an HTTP CONNECT proxy.
  return new HttpsProxyAgent(url, { timeout: 15000 })
}

export interface HttpResponse {
  status: number
  body: string
  headers: http.IncomingHttpHeaders
  bytes: number
  ms: number
}

export function httpGet(
  targetUrl: string,
  opts: { agent?: http.Agent; timeoutMs?: number; headers?: Record<string, string>; maxBytes?: number } = {}
): Promise<HttpResponse> {
  const { agent, timeoutMs = 15000, headers = {}, maxBytes = 5 * 1024 * 1024 } = opts
  return new Promise((resolve, reject) => {
    let u: URL
    try {
      u = new URL(targetUrl)
    } catch (e) {
      return reject(e)
    }
    const lib = u.protocol === 'https:' ? https : http
    const t0 = Date.now()
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: '*/*',
          ...headers
        },
        timeout: timeoutMs,
        agent
      },
      (res) => {
        const chunks: Buffer[] = []
        let bytes = 0
        res.on('data', (c: Buffer) => {
          bytes += c.length
          if (bytes <= 1024 * 1024) chunks.push(c)
          if (bytes > maxBytes) res.destroy()
        })
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers, bytes, ms: Date.now() - t0 }))
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.end()
  })
}
