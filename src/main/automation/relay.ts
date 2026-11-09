import http from 'http'
import os from 'os'
import { EventEmitter } from 'events'
import { app, BrowserWindow, Notification } from 'electron'
import WebSocket from 'ws'
import { store } from '../store'
import { cloud, refreshTokens } from '../cloud/client'
import { automation } from './service'

// Remote access relay (docs/mcp-automation-plan.md §10). When Settings >
// Automation > remote is on and the user is signed in, the app dials OUT to
// wss://<apiBase>/api/relay/device with the account session. The server
// forwards agent requests (made to /api/relay/<deviceId>/mcp and /v1/*) as
// frames; every frame is an HTTP request description that we replay against
// the local 127.0.0.1:<port> server with our own token and stream back. The
// app never opens an inbound port, and the relay knows nothing about tools.
//
// Frames, server -> device:
//   { t: 'req', id, method, path, headers, body }   body: base64 or null
//   { t: 'abort', id }                               agent went away
// Frames, device -> server:
//   { t: 'hello', name, platform, version, running }
//   { t: 'status', running }                        every STATUS_MS
//   { t: 'res', id, status, headers }               local response headers
//   { t: 'chunk', id, b64 }                         body piece (SSE too)
//   { t: 'end', id }
//   { t: 'err', id, message }                       local request failed

export interface RelayStatus {
  connected: boolean
  error: string | null
  deviceId: string | null
}

interface ApplyOpts {
  enabled: boolean
  port: number | null
  token: string
}

type Frame = Record<string, unknown> & { t: string }

const STATUS_MS = 30000
const DEAD_AFTER_MS = 90000 // server pings every ~25 s
const MAX_BACKOFF_MS = 60000
// Hop-by-hop or relay-owned headers that must not be replayed either way.
const DROP_HEADERS = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'content-length', 'authorization', 'origin', 'upgrade', 'proxy-authorization', 'te', 'trailer'])

class RelayClient extends EventEmitter {
  private ws: WebSocket | null = null
  private opts: ApplyOpts = { enabled: false, port: null, token: '' }
  private connected = false
  private error: string | null = null
  private attempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private statusTimer: NodeJS.Timeout | null = null
  private deadTimer: NodeJS.Timeout | null = null
  private pending = new Map<string, http.ClientRequest>()
  private notified = false
  private listening = false
  private connecting = false

  status(): RelayStatus {
    return { connected: this.connected, error: this.error, deviceId: this.connected ? store().cloud.deviceId || null : null }
  }

  // Called by the automation server whenever it starts, stops or the
  // settings change. Idempotent.
  apply(opts: ApplyOpts): void {
    if (!this.listening) {
      this.listening = true
      store().on('cloud', () => this.reconsider('session changed'))
    }
    const portChanged = this.opts.port !== opts.port || this.opts.token !== opts.token
    this.opts = { ...opts }
    if (!this.wanted()) {
      this.disconnect(opts.enabled ? this.whyNot() : null)
      return
    }
    if (this.connected && !portChanged) return
    if (portChanged) this.disconnect(null)
    this.reconsider('apply')
  }

  private wanted(): boolean {
    return this.opts.enabled && this.opts.port !== null && !!store().cloud.session
  }

  private whyNot(): string | null {
    if (!this.opts.enabled) return null
    if (this.opts.port === null) return 'automation_off'
    if (!store().cloud.session) return 'not_logged_in'
    return null
  }

  private reconsider(_why: string): void {
    if (!this.wanted()) {
      this.disconnect(this.whyNot())
      return
    }
    if (this.ws || this.connecting) return
    this.attempt = 0
    this.connect().catch(() => {})
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.ws) return
    this.connecting = true
    try {
      const session = store().cloud.session
      if (!session) return
      if (session.tokens.expiresAt - Date.now() < 120000) await refreshTokens()
      const sess = store().cloud.session
      if (!sess || !this.wanted()) return
      const base = cloud.apiBase().replace(/^http/i, 'ws')
      const ws = new WebSocket(`${base}/api/relay/device`, {
        headers: { authorization: `Bearer ${sess.tokens.accessToken}`, 'user-agent': 'FacetBrowser-desktop' },
        handshakeTimeout: 15000,
        perMessageDeflate: false
      })
      this.ws = ws
      ws.on('open', () => {
        this.connected = true
        this.error = null
        this.attempt = 0
        this.notified = false
        this.send({ t: 'hello', name: os.hostname(), platform: process.platform, version: app.getVersion(), running: this.runningCount() })
        this.statusTimer = setInterval(() => this.send({ t: 'status', running: this.runningCount() }), STATUS_MS)
        this.touch()
        this.emit('status', this.status())
      })
      ws.on('message', (data) => {
        this.touch()
        let frame: Frame
        try {
          frame = JSON.parse(data.toString()) as Frame
        } catch {
          return
        }
        this.onFrame(frame)
      })
      ws.on('ping', () => this.touch())
      ws.on('error', (e) => {
        // "Unexpected server response: 401" when the relay refused the upgrade.
        const m = /Unexpected server response: (\d+)/.exec(e.message)
        if (m) {
          const code = Number(m[1])
          this.error = code === 401 ? 'session_expired' : code === 403 ? 'relay_forbidden' : code === 404 ? 'relay_unavailable' : `relay_http_${code}`
          if (code === 401) refreshTokens().catch(() => {})
        } else {
          this.error = e.message
        }
      })
      ws.on('close', (code, reason) => {
        const wasConnected = this.connected
        this.cleanupSocket(ws)
        if (wasConnected && !this.error && code !== 1000) this.error = `closed (${code}${reason?.length ? ' ' + reason.toString() : ''})`
        this.emit('status', this.status())
        if (this.wanted()) this.scheduleReconnect()
      })
    } finally {
      this.connecting = false
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.attempt, 6)) + Math.floor(Math.random() * 500)
    this.attempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.wanted() && !this.ws) this.connect().catch(() => {})
    }, delay)
  }

  private disconnect(error: string | null): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const ws = this.ws
    if (ws) {
      this.cleanupSocket(ws)
      try {
        ws.close(1000, 'relay off')
      } catch {
        ws.terminate()
      }
    }
    const changed = this.connected || this.error !== error
    this.connected = false
    this.error = error
    if (changed) this.emit('status', this.status())
  }

  private cleanupSocket(ws: WebSocket): void {
    if (this.ws === ws) this.ws = null
    ws.removeAllListeners('message')
    this.connected = false
    if (this.statusTimer) clearInterval(this.statusTimer)
    this.statusTimer = null
    if (this.deadTimer) clearTimeout(this.deadTimer)
    this.deadTimer = null
    for (const req of this.pending.values()) req.destroy()
    this.pending.clear()
  }

  // No frame or ping for DEAD_AFTER_MS: the TCP connection is gone without a
  // FIN (laptop lid, NAT timeout). Terminate so 'close' fires and we redial.
  private touch(): void {
    if (this.deadTimer) clearTimeout(this.deadTimer)
    this.deadTimer = setTimeout(() => {
      this.error = 'relay_timeout'
      this.ws?.terminate()
    }, DEAD_AFTER_MS)
  }

  private send(frame: Frame): void {
    const ws = this.ws
    if (!ws || ws.readyState !== ws.OPEN) return
    try {
      ws.send(JSON.stringify(frame))
    } catch {
      /* socket is closing; 'close' handles it */
    }
  }

  private runningCount(): number {
    try {
      return automation.listProfiles().filter((p) => p.state === 'running').length
    } catch {
      return 0
    }
  }

  // ---- frames -------------------------------------------------------------

  private onFrame(f: Frame): void {
    if (f.t === 'req') return this.onRequest(f as unknown as { id: string; method: string; path: string; headers?: Record<string, string>; body?: string | null })
    if (f.t === 'abort') {
      const id = String(f.id)
      this.pending.get(id)?.destroy()
      this.pending.delete(id)
    }
  }

  private onRequest(f: { id: string; method: string; path: string; headers?: Record<string, string>; body?: string | null }): void {
    const port = this.opts.port
    if (port === null) {
      this.send({ t: 'err', id: f.id, message: 'Automation API is off' })
      return
    }
    if (!this.notified) {
      this.notified = true
      this.notifyFirstRequest()
    }
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(f.headers || {})) {
      if (typeof v === 'string' && !DROP_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = v
    }
    const body = f.body ? Buffer.from(f.body, 'base64') : null
    headers.authorization = `Bearer ${this.opts.token}`
    headers.host = `127.0.0.1:${port}`
    headers['x-facet-relay'] = '1'
    if (body) headers['content-length'] = String(body.length)
    const path = f.path.startsWith('/') ? f.path : `/${f.path}`
    const req = http.request({ host: '127.0.0.1', port, method: f.method, path, headers })
    this.pending.set(f.id, req)
    req.on('response', (res) => {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(res.headers)) {
        if (DROP_HEADERS.has(k) || v === undefined) continue
        out[k] = Array.isArray(v) ? v.join(', ') : v
      }
      this.send({ t: 'res', id: f.id, status: res.statusCode || 502, headers: out })
      res.on('data', (c: Buffer) => this.send({ t: 'chunk', id: f.id, b64: c.toString('base64') }))
      res.on('end', () => {
        this.send({ t: 'end', id: f.id })
        this.pending.delete(f.id)
      })
      res.on('error', (e) => {
        this.send({ t: 'err', id: f.id, message: e.message })
        this.pending.delete(f.id)
      })
    })
    req.on('error', (e) => {
      if (this.pending.has(f.id)) this.send({ t: 'err', id: f.id, message: e.message })
      this.pending.delete(f.id)
    })
    if (body) req.end(body)
    else req.end()
  }

  // Second gate on the device: the first remote request of a connection
  // shows a notification, so profiles never move "on their own" unnoticed.
  private notifyFirstRequest(): void {
    try {
      if (!Notification.isSupported()) return
      const tr = store().settings.language !== 'en'
      const n = new Notification({
        title: tr ? 'FacetBrowser: uzak erişim' : 'FacetBrowser: remote access',
        body: tr
          ? 'Uzak bir ajan bu bilgisayardaki profilleri facetbrowser.com üzerinden sürüyor. Kesmek için Ayarlar › Otomasyon API › uzak erişimi kapat.'
          : 'A remote agent is driving profiles on this computer through facetbrowser.com. To cut it off, turn off remote access in Settings › Automation API.'
      })
      n.on('click', () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
        }
      })
      n.show()
    } catch {
      /* notifications are best effort */
    }
  }
}

export const relay = new RelayClient()
