import http from 'http'
import fs from 'fs'
import path from 'path'
import { timingSafeEqual } from 'crypto'
import { EventEmitter } from 'events'
import { app } from 'electron'
import { WebSocketServer, type WebSocket } from 'ws'
import type { AutomationSettings } from '@shared/types'
import type { AutomationEvent, AutomationEventType, AutomationStatus, DiscoveryFile } from '@shared/automation'
import { AutomationError, automation } from './service'
import { events } from './events'
import { tools, matchRoute, knownPath, coerceArgs, validateArgs, openapi } from './registry'
import { mcpHost } from './mcp'

// HTTP + WebSocket front for the AutomationService. Bound to 127.0.0.1 only;
// every request needs `Authorization: Bearer <token>`; requests that carry an
// Origin header (a browser page) are refused, as are Host headers that are
// not loopback, so a page on some website cannot reach the API even if it
// learns the port (DNS rebinding). The discovery file lets local clients
// (facetbrowser-mcp later) find port and token without any copy-paste.

const BODY_LIMIT = 5 * 1024 * 1024
const HEALTH_PATH = '/health'
const CONSOLE_POLL_MS = 2000

interface Client {
  ws: WebSocket
  profile: string | null
  types: Set<AutomationEventType> | null
}

class AutomationServer extends EventEmitter {
  private server: http.Server | null = null
  private wss: WebSocketServer | null = null
  private clients = new Set<Client>()
  private port: number | null = null
  private error: string | null = null
  private token = ''
  private current: AutomationSettings | null = null
  private starting: Promise<void> | null = null

  constructor() {
    super()
    events.on('event', (ev: AutomationEvent) => this.broadcast(ev))
    mcpHost.configure({ audit: (tool, ids, ms, error) => this.audit(`mcp:${tool}`, ids, ms, error), version: app.getVersion() })
  }

  get discoveryFile(): string {
    return path.join(app.getPath('userData'), 'automation.json')
  }

  status(): AutomationStatus {
    return { running: !!this.server && this.port !== null, port: this.port, error: this.error, discoveryFile: this.discoveryFile }
  }

  // Idempotent: called at startup and whenever settings are saved. Restarts
  // only when something that matters (enabled, port, token) changed.
  async apply(s: AutomationSettings | undefined): Promise<void> {
    if (this.starting) await this.starting.catch(() => {})
    if (!s || !s.enabled) {
      await this.stop()
      this.current = s || null
      return
    }
    const same = this.current && this.current.enabled && this.current.port === s.port && this.current.token === s.token && this.server
    this.current = { ...s }
    if (same) return
    await this.stop()
    this.starting = this.start(s).finally(() => (this.starting = null))
    await this.starting
  }

  private async start(s: AutomationSettings): Promise<void> {
    this.error = null
    this.token = s.token
    const server = http.createServer((req, res) => this.handle(req, res))
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname !== '/events' && url.pathname !== '/v1/events') return refuseUpgrade(socket, 404)
      if (req.headers.origin || !loopbackHost(req.headers.host)) return refuseUpgrade(socket, 403)
      const header = bearerOf(req.headers.authorization) ?? url.searchParams.get('token')
      if (!this.authorized(header)) return refuseUpgrade(socket, 401)
      wss.handleUpgrade(req, socket, head, (ws) => {
        const types = url.searchParams.get('types')
        const client: Client = {
          ws,
          profile: url.searchParams.get('profile'),
          types: types ? new Set(types.split(',').map((t) => t.trim()).filter(Boolean) as AutomationEventType[]) : null
        }
        this.clients.add(client)
        this.updateConsolePoll()
        ws.on('close', () => { this.clients.delete(client); this.updateConsolePoll() })
        ws.on('error', () => { this.clients.delete(client); this.updateConsolePoll() })
        ws.send(JSON.stringify({ type: 'hello', ts: Date.now(), profile: client.profile, types: client.types ? [...client.types] : null }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(s.port, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    }).catch((e) => {
      this.error = (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${s.port} is in use` : (e as Error).message
      server.close()
      this.emit('status', this.status())
      throw e
    })
    server.on('error', (e) => {
      this.error = e.message
      this.emit('status', this.status())
    })
    const addr = server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : s.port
    this.server = server
    this.wss = wss
    this.writeDiscovery()
    this.emit('status', this.status())
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    await mcpHost.closeAll().catch(() => {})
    for (const c of this.clients) c.ws.close(1001, 'server stopping')
    this.clients.clear()
    this.updateConsolePoll()
    this.wss?.close()
    this.wss = null
    this.port = null
    this.removeDiscovery()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    this.emit('status', this.status())
  }

  // ---- auth -------------------------------------------------------------

  private authorized(presented: string | null | undefined): boolean {
    if (!presented || !this.token) return false
    const a = Buffer.from(presented)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  // ---- http -------------------------------------------------------------

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const started = Date.now()
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const method = (req.method || 'GET').toUpperCase()
    let toolName = '-'
    let ids = ''
    try {
      if (req.headers.origin !== undefined) throw new AutomationError('origin_not_allowed', 'Requests with an Origin header are refused; this API is for local tools, not web pages', 403)
      if (!loopbackHost(req.headers.host)) throw new AutomationError('bad_host', 'Host must be 127.0.0.1 or localhost', 403)
      if (url.pathname === HEALTH_PATH && method === 'GET') {
        return json(res, 200, { ok: true, app: 'FacetBrowser', version: app.getVersion(), pid: process.pid })
      }
      if (!this.authorized(bearerOf(req.headers.authorization))) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="FacetBrowser Automation"')
        throw new AutomationError('unauthorized', 'Missing or wrong bearer token (Settings > Automation, or automation.json)', 401)
      }
      // MCP (Streamable HTTP): the SDK transport reads the body and answers itself.
      if (url.pathname === '/mcp') {
        await mcpHost.handle(req, res)
        return
      }
      if (url.pathname === '/openapi.json' && method === 'GET') return json(res, 200, openapi(this.port || 0, app.getVersion()))
      if (url.pathname === '/v1/tools' && method === 'GET') return json(res, 200, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, rest: t.rest })) })

      const match = matchRoute(method, url.pathname)
      if (!match) {
        if (knownPath(url.pathname)) throw new AutomationError('method_not_allowed', `${method} is not allowed on ${url.pathname}`, 405)
        throw new AutomationError('not_found', `No route ${method} ${url.pathname}; see GET /openapi.json`, 404)
      }
      toolName = match.tool.name
      const body = method === 'GET' || method === 'DELETE' ? {} : await readJson(req)
      const query: Record<string, string> = {}
      url.searchParams.forEach((v, k) => (query[k] = v))
      const args = { ...coerceArgs(match.tool, query), ...body, ...coerceArgs(match.tool, match.params) }
      for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k]
      const invalid = validateArgs(match.tool, args)
      if (invalid) throw new AutomationError('bad_input', invalid, 400)
      ids = [args.profileId, args.tabId, args.requestId].filter(Boolean).join(' ')
      const result = await match.tool.handler(args)
      json(res, 200, result ?? { ok: true })
      this.audit(toolName, ids, Date.now() - started, null)
    } catch (e) {
      const err = e instanceof AutomationError ? e : new AutomationError('internal', (e as Error)?.message || String(e), 500)
      if (!res.headersSent) json(res, err.status, { error: { code: err.code, message: err.message } })
      else res.end()
      if (err.code !== 'unauthorized' && err.code !== 'not_found') this.audit(toolName, ids, Date.now() - started, `${err.code}: ${err.message.split('\n')[0]}`)
    }
  }

  // Console history on the engine is pull-based (see AutomationService.
  // pullConsole); while a WS client wants console events, poll it so the
  // stream stays near-live.
  private consolePoll: NodeJS.Timeout | null = null
  private updateConsolePoll(): void {
    const wanted = [...this.clients].some((c) => !c.types || c.types.has('console') || c.types.has('pageerror'))
    if (wanted && !this.consolePoll) this.consolePoll = setInterval(() => automation.pollConsole().catch(() => {}), CONSOLE_POLL_MS)
    if (!wanted && this.consolePoll) {
      clearInterval(this.consolePoll)
      this.consolePoll = null
    }
  }

  private broadcast(ev: AutomationEvent): void {
    if (!this.clients.size) return
    const payload = JSON.stringify(ev)
    for (const c of this.clients) {
      if (c.profile && c.profile !== ev.profileId) continue
      if (c.types && !c.types.has(ev.type)) continue
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(payload)
    }
  }

  // ---- discovery + audit -------------------------------------------------

  private writeDiscovery(): void {
    if (this.port === null) return
    const data: DiscoveryFile = { port: this.port, token: this.token, pid: process.pid, version: app.getVersion() }
    try {
      fs.mkdirSync(path.dirname(this.discoveryFile), { recursive: true })
      fs.writeFileSync(this.discoveryFile, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
    } catch (e) {
      this.error = `Could not write ${this.discoveryFile}: ${(e as Error).message}`
    }
  }

  private removeDiscovery(): void {
    try {
      // Only remove a file this process wrote (a second instance may own it).
      const cur = JSON.parse(fs.readFileSync(this.discoveryFile, 'utf8')) as DiscoveryFile
      if (cur.pid === process.pid) fs.unlinkSync(this.discoveryFile)
    } catch {
      /* no file or not ours */
    }
  }

  // One line per call: time, tool, ids, duration, error. Never payloads.
  private audit(tool: string, ids: string, ms: number, error: string | null): void {
    try {
      const dir = path.join(app.getPath('userData'), 'logs')
      fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(path.join(dir, 'automation.log'), `${new Date().toISOString()} ${tool} ${ids || '-'} ${ms}ms${error ? ' ERROR ' + error : ''}\n`)
    } catch {
      /* logging must never break a call */
    }
  }
}

function bearerOf(header: string | undefined): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? m[1].trim() : null
}

function loopbackHost(host: string | undefined): boolean {
  if (!host) return false
  const h = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return h === '127.0.0.1' || h === 'localhost' || h === '::1'
}

function refuseUpgrade(socket: NodeJS.WritableStream & { destroy?: () => void }, status: number): void {
  const text = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not Found'
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`)
  socket.destroy?.()
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' })
  res.end(text)
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > BODY_LIMIT) {
        reject(new AutomationError('payload_too_large', 'Body over 5 MB', 413))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return reject(new AutomationError('bad_input', 'Body must be a JSON object', 400))
        resolve(parsed)
      } catch {
        reject(new AutomationError('bad_input', 'Body is not valid JSON', 400))
      }
    })
    req.on('error', reject)
  })
}

export const automationServer = new AutomationServer()
