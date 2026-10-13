import http from 'http'
import net from 'net'
import { SocksClient } from 'socks'
import type { ProxyConfig } from '@shared/types'

// Local forwarding proxy. Chromium is pointed at 127.0.0.1:<port> with no
// credentials, and this bridge opens the real upstream connection (HTTP
// CONNECT or SOCKS4/5 with authentication). This keeps credentials out of
// the browser, gives SOCKS5-with-auth support (Chromium has none) and lets us
// count traffic per profile.

export interface Bridge {
  port: number
  bytesIn: number
  bytesOut: number
  close: () => Promise<void>
}

function connectUpstream(proxy: ProxyConfig, host: string, port: number): Promise<net.Socket> {
  if (proxy.protocol === 'socks5' || proxy.protocol === 'socks4') {
    return SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: proxy.protocol === 'socks5' ? 5 : 4,
        userId: proxy.username || undefined,
        password: proxy.password || undefined
      },
      command: 'connect',
      destination: { host, port },
      timeout: 20000
    }).then((r) => r.socket)
  }
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port })
    const auth = proxy.username ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')}\r\n` : ''
    let buf = ''
    const onData = (d: Buffer): void => {
      buf += d.toString('latin1')
      const end = buf.indexOf('\r\n\r\n')
      if (end === -1) return
      socket.removeListener('data', onData)
      const status = buf.split('\r\n')[0]
      const m = status.match(/^HTTP\/1\.[01] (\d{3})/)
      if (!m || m[1] !== '200') {
        socket.destroy()
        return reject(new Error(`Upstream CONNECT failed: ${status}`))
      }
      const rest = Buffer.from(buf.slice(end + 4), 'latin1')
      if (rest.length) socket.unshift(rest)
      resolve(socket)
    }
    socket.setTimeout(20000, () => socket.destroy(new Error('upstream timeout')))
    socket.once('error', reject)
    socket.on('data', onData)
    socket.once('connect', () => {
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}Connection: keep-alive\r\n\r\n`)
    })
  })
}

export function startBridge(proxy: ProxyConfig): Promise<Bridge> {
  const state = { bytesIn: 0, bytesOut: 0 }
  const server = http.createServer()

  // HTTPS and WebSocket: CONNECT tunnel.
  server.on('connect', (req, clientSocket, head) => {
    const [host, portStr] = (req.url || '').split(':')
    const port = parseInt(portStr || '443', 10)
    connectUpstream(proxy, host, port)
      .then((up) => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head && head.length) up.write(head)
        up.on('data', (d) => (state.bytesIn += d.length))
        clientSocket.on('data', (d) => (state.bytesOut += d.length))
        up.pipe(clientSocket)
        clientSocket.pipe(up)
        const kill = (): void => { up.destroy(); clientSocket.destroy() }
        up.on('error', kill)
        clientSocket.on('error', kill)
        up.on('close', () => clientSocket.destroy())
        clientSocket.on('close', () => up.destroy())
      })
      .catch(() => {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
        clientSocket.destroy()
      })
  })

  // Plain HTTP: tunnel the raw request through the upstream connection.
  server.on('request', (req, res) => {
    let u: URL
    try {
      u = new URL(req.url || '')
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const port = parseInt(u.port || '80', 10)
    connectUpstream(proxy, u.hostname, port)
      .then((up) => {
        const headers = { ...req.headers }
        delete headers['proxy-connection']
        delete headers['proxy-authorization']
        headers['connection'] = 'close'
        const lines = [`${req.method} ${u.pathname}${u.search} HTTP/1.1`]
        for (const [k, v] of Object.entries(headers)) {
          if (v === undefined) continue
          for (const vv of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${vv}`)
        }
        up.write(lines.join('\r\n') + '\r\n\r\n')
        req.on('data', (d) => { state.bytesOut += d.length; up.write(d) })
        req.on('end', () => up.end())
        up.on('data', (d) => (state.bytesIn += d.length))
        const sock = res.socket
        if (!sock) { up.destroy(); return }
        res.detachSocket(sock)
        up.pipe(sock)
        up.on('error', () => sock.destroy())
        sock.on('error', () => up.destroy())
        up.on('close', () => sock.destroy())
      })
      .catch((e) => {
        res.writeHead(502, { 'content-type': 'text/plain' })
        res.end(`FacetBrowser bridge: ${e.message}`)
      })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      resolve({
        port: addr.port,
        get bytesIn() { return state.bytesIn },
        get bytesOut() { return state.bytesOut },
        close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()) })
      })
    })
  })
}
