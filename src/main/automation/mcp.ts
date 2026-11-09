import http from 'http'
import { randomUUID } from 'crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SetLevelRequestSchema,
  type LoggingLevel
} from '@modelcontextprotocol/sdk/types.js'
import type { AutomationEvent } from '@shared/automation'
import { automation, AutomationError } from './service'
import { events } from './events'
import { tools, validateArgs, type JsonSchema, type ToolDef } from './registry'

// MCP server (Streamable HTTP) mounted at /mcp by server.ts. One Server +
// transport per MCP session; the session remembers an active profile and
// tab, so an agent that said `facet_select_tab` once can call `facet_click`
// without repeating the tabId. Tools come from the same registry as REST.

export interface McpAudit {
  (tool: string, ids: string, ms: number, error: string | null): void
}

interface Session {
  id: string
  server: Server
  transport: StreamableHTTPServerTransport
  profileId: string | null
  tabId: string | null
  level: LoggingLevel
}

const LEVELS: LoggingLevel[] = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']
const levelAtLeast = (a: LoggingLevel, min: LoggingLevel): boolean => LEVELS.indexOf(a) >= LEVELS.indexOf(min)
const CONSOLE_POLL_MS = 2000

// Session-only tools, on top of the registry.
const SESSION_TOOLS: Array<Pick<ToolDef, 'name' | 'description' | 'inputSchema'>> = [
  {
    name: 'facet_select_profile',
    description: 'Make a profile the default for this session: later calls that take profileId can omit it. Returns its state and tabs (if running). Does not launch it.',
    inputSchema: { type: 'object', properties: { profileId: { type: 'string', description: 'Profile id or exact name' } }, required: ['profileId'], additionalProperties: false }
  },
  {
    name: 'facet_select_tab',
    description: 'Make a tab the default for this session and bring it to the front: later calls that take tabId can omit it.',
    inputSchema: { type: 'object', properties: { tabId: { type: 'string', description: 'Tab id from facet_list_tabs' } }, required: ['tabId'], additionalProperties: false }
  },
  {
    name: 'facet_session_info',
    description: 'Which profile and tab are selected for this session.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
]

// tabId / profileId become optional in the MCP schema: the session fills them.
function mcpSchema(t: ToolDef): JsonSchema {
  const required = ((t.inputSchema.required as string[]) || []).filter((k) => k !== 'tabId' && k !== 'profileId')
  const props = { ...((t.inputSchema.properties || {}) as Record<string, JsonSchema>) }
  for (const k of ['tabId', 'profileId'] as const) {
    if (props[k]) props[k] = { ...props[k], description: `${props[k].description as string}. Optional when ${k === 'tabId' ? 'facet_select_tab' : 'facet_select_profile'} was called in this session.` }
  }
  return { ...t.inputSchema, properties: props, required }
}

class McpHost {
  private sessions = new Map<string, Session>()
  private poll: NodeJS.Timeout | null = null
  private audit: McpAudit = () => {}
  private version = '0.0.0'

  constructor() {
    events.on('event', (ev: AutomationEvent) => this.forward(ev))
  }

  configure(opts: { audit: McpAudit; version: string }): void {
    this.audit = opts.audit
    this.version = opts.version
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const sid = req.headers['mcp-session-id']
    const existing = typeof sid === 'string' ? this.sessions.get(sid) : undefined
    if (existing) return existing.transport.handleRequest(req, res)
    if (sid) {
      jsonRpcError(res, 404, 'Unknown MCP session; initialize again')
      return
    }
    if (req.method !== 'POST') {
      jsonRpcError(res, 400, 'Missing Mcp-Session-Id; POST an initialize request first')
      return
    }
    // A fresh session; the transport validates that the body is initialize.
    const session = this.createSession()
    await session.server.connect(session.transport)
    await session.transport.handleRequest(req, res)
    if (!session.transport.sessionId) await session.transport.close().catch(() => {})
  }

  async closeAll(): Promise<void> {
    for (const s of [...this.sessions.values()]) await s.transport.close().catch(() => {})
    this.sessions.clear()
    this.updatePoll()
  }

  private createSession(): Session {
    const session: Session = { id: '', server: null as unknown as Server, transport: null as unknown as StreamableHTTPServerTransport, profileId: null, tabId: null, level: 'info' }
    session.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        session.id = id
        this.sessions.set(id, session)
        this.updatePoll()
      }
    })
    session.transport.onclose = () => {
      if (session.id) this.sessions.delete(session.id)
      this.updatePoll()
    }
    const server = new Server({ name: 'facetbrowser', version: this.version }, { capabilities: { tools: {}, resources: {}, logging: {} }, instructions: INSTRUCTIONS })
    session.server = server

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...SESSION_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), ...tools.map((t) => ({ name: t.name, description: t.description, inputSchema: mcpSchema(t) }))]
    }))

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const started = Date.now()
      const name = req.params.name
      const args = { ...((req.params.arguments || {}) as Record<string, unknown>) }
      let ids = ''
      try {
        const result = await this.call(session, name, args)
        ids = [args.profileId, args.tabId, args.requestId].filter(Boolean).join(' ')
        this.audit(name, ids, Date.now() - started, null)
        return result
      } catch (e) {
        const err = e instanceof AutomationError ? e : new AutomationError('internal', (e as Error)?.message || String(e), 500)
        this.audit(name, ids, Date.now() - started, `${err.code}: ${err.message.split('\n')[0]}`)
        return { isError: true, content: [{ type: 'text', text: `${err.code}: ${err.message}` }] }
      }
    })

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        { uri: 'facet://profiles', name: 'Profiles', description: 'All profiles with state and tab counts', mimeType: 'application/json' },
        ...automation.listProfiles().filter((p) => p.state === 'running').flatMap((p) => [
          { uri: `facet://profile/${p.id}/tabs`, name: `${p.name}: tabs`, mimeType: 'application/json' },
          { uri: `facet://profile/${p.id}/console`, name: `${p.name}: console`, description: 'Last 100 console/pageerror/dialog events', mimeType: 'application/json' }
        ])
      ]
    }))
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: [
        { uriTemplate: 'facet://profile/{profileId}/tabs', name: 'Tabs of a profile', mimeType: 'application/json' },
        { uriTemplate: 'facet://profile/{profileId}/console', name: 'Console of a profile', description: 'Query: ?last=100&level=error', mimeType: 'application/json' },
        { uriTemplate: 'facet://profile/{profileId}/network', name: 'Network requests of a profile', description: 'Query: ?last=100&url=&type=', mimeType: 'application/json' }
      ]
    }))
    server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
      const text = JSON.stringify(await this.readResource(req.params.uri), null, 2)
      return { contents: [{ uri: req.params.uri, mimeType: 'application/json', text }] }
    })
    server.setRequestHandler(SetLevelRequestSchema, async (req) => {
      session.level = req.params.level
      return {}
    })
    return session
  }

  private async call(session: Session, name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>; isError?: boolean }> {
    const text = (v: unknown): { content: Array<{ type: 'text'; text: string }> } => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] })

    if (name === 'facet_session_info') return text({ profileId: session.profileId, tabId: session.tabId })
    if (name === 'facet_select_profile') {
      const p = automation.resolveProfile(String(args.profileId || ''))
      session.profileId = p.id
      const info = automation.profileInfo(p.id)
      const tabs = info.state === 'running' ? await automation.listTabs(p.id) : []
      if (!tabs.some((t) => t.tabId === session.tabId)) session.tabId = tabs.find((t) => t.active)?.tabId || tabs[0]?.tabId || null
      return text({ profile: info, tabs, selectedTab: session.tabId })
    }
    if (name === 'facet_select_tab') {
      const info = await automation.selectTab(String(args.tabId || ''))
      session.tabId = info.tabId
      session.profileId = info.profileId
      return text(info)
    }

    const tool = tools.find((t) => t.name === name)
    if (!tool) throw new AutomationError('unknown_tool', `Unknown tool ${name}`, 404)
    const props = (tool.inputSchema.properties || {}) as Record<string, JsonSchema>
    const required = (tool.inputSchema.required as string[]) || []
    // Session defaults. console/network/cdp accept either id: prefer the tab.
    if (props.tabId && args.tabId === undefined && !args.profileId) {
      if (session.tabId && automation.hasTab(session.tabId)) args.tabId = session.tabId
      else if (required.includes('tabId')) throw new AutomationError('no_tab', 'No tab selected; pass tabId or call facet_select_tab (facet_list_tabs shows them)', 400)
    }
    if (props.profileId && args.profileId === undefined && !args.tabId) {
      if (session.profileId) args.profileId = session.profileId
      else if (required.includes('profileId') || (props.tabId && !required.includes('tabId'))) throw new AutomationError('no_profile', 'No profile selected; pass profileId or call facet_select_profile (facet_list_profiles shows them)', 400)
    }
    const invalid = validateArgs(tool, args)
    if (invalid) throw new AutomationError('bad_input', invalid, 400)
    const result = (await tool.handler(args)) as Record<string, unknown>

    // Keep the session pointed at what the agent just did.
    if (name === 'facet_launch_profile' || name === 'facet_new_tab' || name === 'facet_list_tabs') {
      const tabs = (name === 'facet_new_tab' ? [result] : (result.tabs as Array<{ tabId: string; profileId: string; active?: boolean }>) || []) as Array<{ tabId: string; profileId: string; active?: boolean }>
      if (tabs.length) {
        session.profileId = tabs[0].profileId
        if (name === 'facet_new_tab' || !tabs.some((t) => t.tabId === session.tabId)) session.tabId = (tabs.find((t) => t.active) || tabs[0]).tabId
      }
    }
    if (name === 'facet_stop_profile' && session.profileId === automation.resolveProfile(String(args.profileId)).id) session.tabId = null
    if (name === 'facet_close_tab' && session.tabId === args.tabId) session.tabId = null

    if (name === 'facet_screenshot') {
      const shot = result as { format: string; base64: string; bytes: number }
      return { content: [{ type: 'image', data: shot.base64, mimeType: shot.format === 'jpeg' ? 'image/jpeg' : 'image/png' }, { type: 'text', text: `${shot.format}, ${shot.bytes} bytes` }] }
    }
    if (name === 'facet_snapshot') {
      const s = result as { snapshot: string; refs: number; truncated: boolean; url: string; title: string }
      return text(`${s.title} — ${s.url} (${s.refs} refs${s.truncated ? ', truncated' : ''})\n${s.snapshot}`)
    }
    if (name === 'facet_get_text' || name === 'facet_get_html') {
      const s = result as { text: string; truncated: boolean; length: number }
      return text(s.truncated ? `${s.text}\n… (truncated, ${s.length} chars; raise maxChars)` : s.text)
    }
    return text(result)
  }

  private async readResource(uri: string): Promise<unknown> {
    const u = new URL(uri)
    if (u.protocol !== 'facet:') throw new AutomationError('bad_uri', `Unknown scheme in ${uri}`, 404)
    const parts = `${u.host}${u.pathname}`.split('/').filter(Boolean)
    if (parts[0] === 'profiles') return automation.listProfiles()
    if (parts[0] === 'profile' && parts[1]) {
      const profileId = automation.resolveProfile(decodeURIComponent(parts[1])).id
      const last = Number(u.searchParams.get('last') || 100)
      if (parts[2] === 'tabs') return automation.listTabs(profileId)
      if (parts[2] === 'console') return automation.consoleRead({ profileId }, { last, level: u.searchParams.get('level') || undefined })
      if (parts[2] === 'network') return automation.networkList({ profileId }, { last, url: u.searchParams.get('url') || undefined, type: u.searchParams.get('type') || undefined })
      if (!parts[2]) return automation.profileInfo(profileId)
    }
    throw new AutomationError('bad_uri', `Unknown resource ${uri}`, 404)
  }

  // Console and page errors of a session's profile go out as MCP log messages.
  private forward(ev: AutomationEvent): void {
    if (ev.type !== 'console' && ev.type !== 'pageerror') return
    const level: LoggingLevel = ev.type === 'pageerror' ? 'error' : ev.data.level === 'error' ? 'error' : ev.data.level === 'warning' ? 'warning' : ev.data.level === 'debug' ? 'debug' : 'info'
    for (const s of this.sessions.values()) {
      if (s.profileId !== ev.profileId || !levelAtLeast(level, s.level)) continue
      s.server.sendLoggingMessage({ level, logger: `facet/${ev.tabId || ev.profileId}`, data: { type: ev.type, ...ev.data, seq: ev.seq, tabId: ev.tabId } }).catch(() => {})
    }
  }

  // The engine's console is pull-based (service.pullConsole); poll while a
  // session has a profile so the log notifications stay near-live.
  private updatePoll(): void {
    const wanted = [...this.sessions.values()].some((s) => s.profileId)
    if (wanted && !this.poll) this.poll = setInterval(() => automation.pollConsole().catch(() => {}), CONSOLE_POLL_MS)
    if (!wanted && this.poll) {
      clearInterval(this.poll)
      this.poll = null
    }
  }
}

const INSTRUCTIONS = `FacetBrowser: anti-detect browser profiles, each with its own fingerprint, proxy and cookies, driven here through a local API.
Typical flow: facet_list_profiles -> facet_launch_profile (or facet_select_profile if already running) -> facet_snapshot to read the page with element refs -> facet_click / facet_type / facet_fill by ref -> facet_snapshot again. Prefer facet_snapshot over facet_screenshot for reading; use facet_evaluate for data the DOM does not expose. Console and network history are available via facet_console_read / facet_network_list. After facet_select_tab the tabId can be omitted. Nothing is injected into pages; the user may be using the same window, so avoid closing tabs you did not open.`

function jsonRpcError(res: http.ServerResponse, status: number, message: string): void {
  const body = JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null })
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

export const mcpHost = new McpHost()
