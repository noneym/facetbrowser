import type { ProxyConfig, ProxyProtocol } from '@shared/types'

const PROTOCOLS: ProxyProtocol[] = ['http', 'https', 'socks4', 'socks5']

// Accepts the common formats people paste from providers:
//   socks5://user:pass@host:port
//   http://host:port
//   host:port
//   host:port:user:pass
//   user:pass@host:port
//   host:port@user:pass
export function parseProxyLine(rawLine: string, defaultProtocol: ProxyProtocol = 'http'): ProxyConfig | null {
  let line = String(rawLine || '').trim()
  if (!line) return null
  line = line.replace(/\[([^\]]+)\]\(mailto:[^)]+\)/g, '$1').replace(/^["'`]|["'`]$/g, '').trim()

  let protocol: ProxyProtocol = defaultProtocol
  const m = line.match(/^(socks5h?|socks4a?|https?):\/\/(.+)$/i)
  if (m) {
    const p = m[1].toLowerCase().replace('socks5h', 'socks5').replace('socks4a', 'socks4') as ProxyProtocol
    if (!PROTOCOLS.includes(p)) return null
    protocol = p
    line = m[2]
  }

  let username: string | undefined
  let password: string | undefined
  let hostPort = line

  const at = line.lastIndexOf('@')
  if (at > -1) {
    const left = line.slice(0, at)
    const right = line.slice(at + 1)
    // user:pass@host:port  or  host:port@user:pass
    if (/^[^:\s]+:\d+$/.test(right)) {
      hostPort = right
      const c = left.indexOf(':')
      username = c > -1 ? left.slice(0, c) : left
      password = c > -1 ? left.slice(c + 1) : ''
    } else if (/^[^:\s]+:\d+$/.test(left)) {
      hostPort = left
      const c = right.indexOf(':')
      username = c > -1 ? right.slice(0, c) : right
      password = c > -1 ? right.slice(c + 1) : ''
    } else {
      return null
    }
  } else {
    const parts = line.split(':')
    if (parts.length === 4 && /^\d+$/.test(parts[1])) {
      hostPort = `${parts[0]}:${parts[1]}`
      username = parts[2]
      password = parts[3]
    } else if (parts.length === 4 && /^\d+$/.test(parts[3])) {
      // user:pass:host:port
      username = parts[0]
      password = parts[1]
      hostPort = `${parts[2]}:${parts[3]}`
    }
  }

  const hp = hostPort.match(/^([^:\s]+):(\d{1,5})$/)
  if (!hp) return null
  const port = parseInt(hp[2], 10)
  if (!(port > 0 && port < 65536)) return null
  const cfg: ProxyConfig = { protocol, host: hp[1], port }
  if (username) {
    cfg.username = safeDecode(username)
    cfg.password = safeDecode(password || '')
  }
  return cfg
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

export function proxyToUrl(p: ProxyConfig, includeAuth = true): string {
  const auth = includeAuth && p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || '')}@` : ''
  return `${p.protocol}://${auth}${p.host}:${p.port}`
}

export function proxyLabel(p: ProxyConfig): string {
  return `${p.protocol}://${p.host}:${p.port}`
}

export function parseProxyList(text: string, defaultProtocol: ProxyProtocol = 'http'): Array<{ raw: string; parsed: ProxyConfig | null }> {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((raw) => ({ raw, parsed: parseProxyLine(raw, defaultProtocol) }))
}
