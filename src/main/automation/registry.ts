import { automation, type Target } from './service'
import type { AutomationEventType } from '@shared/automation'

// Every capability is one record: name, description, JSON Schema input and
// handler. The REST router, GET /openapi.json and (Faz 2) MCP tools/list are
// generated from this list, so a new capability is added exactly once.

export type JsonSchema = Record<string, unknown>

export interface RestRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string // /v1/tabs/{tabId}/click ; {name} segments become arguments
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: JsonSchema
  rest: RestRoute[]
  // Which argument names the audit log records (ids only, never payloads).
  handler: (args: Record<string, any>) => Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ---- schema helpers -----------------------------------------------------

const str = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', description, ...extra })
const int = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'integer', description, ...extra })
const num = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'number', description, ...extra })
const bool = (description: string): JsonSchema => ({ type: 'boolean', description })
const enumOf = (description: string, values: string[]): JsonSchema => ({ type: 'string', enum: values, description })
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false })

const tabId = str('Tab id from facet_list_tabs / facet_launch_profile (t_xxxxxx)')
const profileId = str('Profile id (p_...) or its exact name')
const target = {
  ref: str('Element ref from the latest facet_snapshot or facet_find, e.g. "e12". Preferred.'),
  selector: str('Alternative to ref: CSS selector, or text=..., role=button[name="Save"], xpath=...')
}
const targetOf = (a: Record<string, unknown>): Target => ({ ref: a.ref as string | undefined, selector: a.selector as string | undefined })
const timeoutMs = int('Timeout in milliseconds', { minimum: 100, maximum: 120000 })

const EVENT_TYPES: AutomationEventType[] = ['console', 'pageerror', 'dialog', 'request', 'response', 'requestfailed', 'framenavigated', 'page', 'close']

// ---- tools --------------------------------------------------------------

export const tools: ToolDef[] = [
  // Profiles
  {
    name: 'facet_list_profiles',
    description: 'List all FacetBrowser profiles with id, name, group, tags, proxy country, running state and open tab count. Start here to pick a profile.',
    inputSchema: obj({}),
    rest: [{ method: 'GET', path: '/v1/profiles' }],
    handler: async () => ({ profiles: automation.listProfiles() })
  },
  {
    name: 'facet_profile_info',
    description: 'Details of one profile: state, tab count, proxy, and cdpUrl when "expose CDP" is enabled in Settings.',
    inputSchema: obj({ profileId }, ['profileId']),
    rest: [{ method: 'GET', path: '/v1/profiles/{profileId}' }],
    handler: async (a) => automation.profileInfo(a.profileId)
  },
  {
    name: 'facet_launch_profile',
    description: 'Launch a profile (opens its browser window with the saved fingerprint and proxy). Returns once it is running, with the list of its tabs. Idempotent for an already running profile.',
    inputSchema: obj({ profileId, force: bool('Take over a profile that is open on another device (closes it there first)') }, ['profileId']),
    rest: [{ method: 'POST', path: '/v1/profiles/{profileId}/launch' }],
    handler: async (a) => {
      const p = automation.resolveProfile(a.profileId)
      const info = automation.profileInfo(p.id)
      if (info.state !== 'running') await automation.launchProfile(p.id, !!a.force)
      const tabs = await automation.listTabs(p.id)
      return { profile: automation.profileInfo(p.id), tabs }
    }
  },
  {
    name: 'facet_stop_profile',
    description: 'Close a running profile (its session is saved and uploaded like a normal close).',
    inputSchema: obj({ profileId }, ['profileId']),
    rest: [{ method: 'POST', path: '/v1/profiles/{profileId}/stop' }],
    handler: async (a) => {
      await automation.stopProfile(a.profileId)
      return { ok: true }
    }
  },

  // Tabs
  {
    name: 'facet_list_tabs',
    description: 'List the open tabs of a running profile: tabId, url, title, active.',
    inputSchema: obj({ profileId }, ['profileId']),
    rest: [{ method: 'GET', path: '/v1/profiles/{profileId}/tabs' }],
    handler: async (a) => ({ tabs: await automation.listTabs(a.profileId) })
  },
  {
    name: 'facet_new_tab',
    description: 'Open a new tab in a running profile, optionally navigating to a URL. Returns the new tabId.',
    inputSchema: obj({ profileId, url: str('URL to open (optional)') }, ['profileId']),
    rest: [{ method: 'POST', path: '/v1/profiles/{profileId}/tabs' }],
    handler: async (a) => automation.newTab(a.profileId, a.url)
  },
  {
    name: 'facet_tab_info',
    description: 'Current url and title of a tab.',
    inputSchema: obj({ tabId }, ['tabId']),
    rest: [{ method: 'GET', path: '/v1/tabs/{tabId}' }],
    handler: async (a) => automation.tabInfo(a.tabId)
  },
  {
    name: 'facet_close_tab',
    description: 'Close a tab. Closing the last tab closes the profile.',
    inputSchema: obj({ tabId }, ['tabId']),
    rest: [{ method: 'DELETE', path: '/v1/tabs/{tabId}' }],
    handler: async (a) => {
      await automation.closeTab(a.tabId)
      return { ok: true }
    }
  },
  {
    name: 'facet_select_tab',
    description: 'Bring a tab to the front (makes it the active tab in the window).',
    inputSchema: obj({ tabId }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/select' }],
    handler: async (a) => automation.selectTab(a.tabId)
  },

  // Navigation
  {
    name: 'facet_navigate',
    description: 'Navigate a tab to a URL and wait for it to load. Returns final url, title and HTTP status.',
    inputSchema: obj({ tabId, url: str('Absolute URL; "https://" is assumed when the scheme is missing'), waitUntil: enumOf('When to consider navigation done (default load)', ['load', 'domcontentloaded', 'networkidle', 'commit']), timeoutMs }, ['tabId', 'url']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/navigate' }],
    handler: async (a) => automation.navigate(a.tabId, a.url, a.waitUntil, a.timeoutMs)
  },
  {
    name: 'facet_go_back',
    description: 'History back.',
    inputSchema: obj({ tabId, timeoutMs }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/back' }],
    handler: async (a) => automation.goBack(a.tabId, a.timeoutMs)
  },
  {
    name: 'facet_go_forward',
    description: 'History forward.',
    inputSchema: obj({ tabId, timeoutMs }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/forward' }],
    handler: async (a) => automation.goForward(a.tabId, a.timeoutMs)
  },
  {
    name: 'facet_reload',
    description: 'Reload the tab.',
    inputSchema: obj({ tabId, timeoutMs }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/reload' }],
    handler: async (a) => automation.reload(a.tabId, a.timeoutMs)
  },
  {
    name: 'facet_wait_for',
    description: 'Wait until a selector or text is visible (or hidden), the URL contains a string / matches a glob, a load state is reached, or a fixed time passes. Any combination; all must hold.',
    inputSchema: obj({
      tabId,
      selector: str('Selector to wait for'),
      text: str('Visible text to wait for'),
      url: str('URL substring, or glob with *'),
      state: enumOf('Element state to wait for (default visible)', ['attached', 'visible', 'hidden', 'detached']),
      loadState: enumOf('Page load state', ['load', 'domcontentloaded', 'networkidle']),
      timeMs: int('Plain delay in ms (max 60000)', { minimum: 0, maximum: 60000 }),
      timeoutMs
    }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/wait' }],
    handler: async (a) => automation.waitFor(a.tabId, a)
  },

  // Reading
  {
    name: 'facet_snapshot',
    description: 'Accessibility snapshot of the page as an indented tree, each element tagged [ref=eN]. Use the refs with facet_click / facet_type / facet_fill. Prefer this over screenshots for reading the page. interactiveOnly gives a compact list of buttons, links and fields.',
    inputSchema: obj({ tabId, interactiveOnly: bool('Only interactive elements and headings, flattened'), depth: int('Limit tree depth'), maxChars: int('Truncate the snapshot (default 60000)') }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/snapshot' }, { method: 'GET', path: '/v1/tabs/{tabId}/snapshot' }],
    handler: async (a) => automation.snapshot(a.tabId, { interactiveOnly: a.interactiveOnly, depth: a.depth, maxChars: a.maxChars })
  },
  {
    name: 'facet_find',
    description: 'Find elements by visible name or role (case-insensitive) in the current page; returns their refs for use in actions.',
    inputSchema: obj({ tabId, query: str('Text or role to look for, e.g. "Sign in" or "textbox"'), limit: int('Max matches (default 50)') }, ['tabId', 'query']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/find' }],
    handler: async (a) => ({ matches: await automation.find(a.tabId, a.query, a.limit) })
  },
  {
    name: 'facet_get_text',
    description: 'innerText of the page body or of one element.',
    inputSchema: obj({ tabId, ...target, maxChars: int('Truncate (default 20000)') }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/text' }, { method: 'GET', path: '/v1/tabs/{tabId}/text' }],
    handler: async (a) => automation.getText(a.tabId, targetOf(a), a.maxChars)
  },
  {
    name: 'facet_get_html',
    description: 'outerHTML of one element, or the full document HTML.',
    inputSchema: obj({ tabId, ...target, maxChars: int('Truncate (default 50000)') }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/html' }, { method: 'GET', path: '/v1/tabs/{tabId}/html' }],
    handler: async (a) => automation.getHtml(a.tabId, targetOf(a), a.maxChars)
  },
  {
    name: 'facet_screenshot',
    description: 'Screenshot of the viewport, the full page, a clip, or one element. Returns base64 PNG/JPEG. Rate limited to one per 200 ms per tab.',
    inputSchema: obj({
      tabId,
      ...target,
      fullPage: bool('Capture the whole scrollable page'),
      format: enumOf('Image format (default png)', ['png', 'jpeg']),
      quality: int('JPEG quality 0-100', { minimum: 0, maximum: 100 }),
      clip: { type: 'object', description: 'Viewport rectangle to capture', properties: { x: num('x'), y: num('y'), width: num('width'), height: num('height') }, required: ['x', 'y', 'width', 'height'] }
    }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/screenshot' }],
    handler: async (a) => automation.screenshot(a.tabId, { ...targetOf(a), fullPage: a.fullPage, format: a.format, quality: a.quality, clip: a.clip })
  },

  // Interaction
  {
    name: 'facet_click',
    description: 'Click an element by ref or selector.',
    inputSchema: obj({ tabId, ...target, button: enumOf('Mouse button (default left)', ['left', 'right', 'middle']), clickCount: int('1 = click, 2 = double click'), modifiers: { type: 'array', items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] }, description: 'Held modifier keys' }, timeoutMs }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/click' }],
    handler: async (a) => automation.click(a.tabId, targetOf(a), { button: a.button, clickCount: a.clickCount, modifiers: a.modifiers, timeoutMs: a.timeoutMs })
  },
  {
    name: 'facet_type',
    description: 'Type text into an element key by key (use delayMs for human-like speed). clear empties the field first; pressEnter submits.',
    inputSchema: obj({ tabId, ...target, text: str('Text to type'), clear: bool('Clear the field first'), pressEnter: bool('Press Enter afterwards'), delayMs: int('Delay between keystrokes in ms (default 0)', { minimum: 0, maximum: 1000 }), timeoutMs }, ['tabId', 'text']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/type' }],
    handler: async (a) => automation.type(a.tabId, targetOf(a), a.text, { clear: a.clear, pressEnter: a.pressEnter, delayMs: a.delayMs, timeoutMs: a.timeoutMs })
  },
  {
    name: 'facet_fill',
    description: 'Set the value of an input/textarea at once, check/uncheck a checkbox (true/false), or choose a <select> option (value or label; array for multi-select).',
    inputSchema: obj({ tabId, ...target, value: { description: 'New value', anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }] }, timeoutMs }, ['tabId', 'value']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/fill' }],
    handler: async (a) => automation.fill(a.tabId, targetOf(a), a.value, a.timeoutMs)
  },
  {
    name: 'facet_press',
    description: 'Press a key or chord ("Enter", "Control+A", "ArrowDown"); a space-separated list presses them in sequence. With ref/selector the element is focused first.',
    inputSchema: obj({ tabId, keys: str('Key, chord or space-separated sequence'), ...target, timeoutMs }, ['tabId', 'keys']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/press' }],
    handler: async (a) => automation.press(a.tabId, a.keys, targetOf(a), a.timeoutMs)
  },
  {
    name: 'facet_hover',
    description: 'Hover an element (opens hover menus, tooltips).',
    inputSchema: obj({ tabId, ...target, timeoutMs }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/hover' }],
    handler: async (a) => automation.hover(a.tabId, targetOf(a), a.timeoutMs)
  },
  {
    name: 'facet_scroll',
    description: 'Scroll the page by a direction and amount (default down 600px), or scroll an element into view when ref/selector is given.',
    inputSchema: obj({ tabId, ...target, direction: enumOf('Scroll direction', ['up', 'down', 'left', 'right']), amount: int('Pixels (default 600)') }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/scroll' }],
    handler: async (a) => automation.scroll(a.tabId, { ...targetOf(a), direction: a.direction, amount: a.amount })
  },
  {
    name: 'facet_handle_dialog',
    description: 'Accept or dismiss the alert/confirm/prompt that is open on a tab (see the "dialog" event in facet_console_read).',
    inputSchema: obj({ tabId, accept: bool('true = OK, false = Cancel'), promptText: str('Text to enter for a prompt()') }, ['tabId', 'accept']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/dialog' }],
    handler: async (a) => automation.handleDialog(a.tabId, !!a.accept, a.promptText)
  },

  // JavaScript
  {
    name: 'facet_evaluate',
    description: 'Run JavaScript in the page now and return its JSON result (promises are awaited). Pass an expression, or a function source with args. With ref/selector the element is available as `el`. Nothing is injected at page load; the call is the only trace.',
    inputSchema: obj({ tabId, expression: str('JS expression, e.g. "document.title"'), function: str('Function source, e.g. "(a, b) => a + b"'), args: { type: 'array', description: 'Arguments for function' }, ...target, timeoutMs }, ['tabId']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/evaluate' }],
    handler: async (a) => automation.evaluate(a.tabId, { expression: a.expression, function: a.function, args: a.args, timeoutMs: a.timeoutMs, ...targetOf(a) })
  },

  // Console
  {
    name: 'facet_console_read',
    description: 'Console messages, uncaught page errors and dialogs recorded for a tab or a whole profile (ring buffer of the last 2000). Filter by level (log, warning, error, ...) or by seq with since.',
    inputSchema: obj({ profileId: str('Profile id; or pass tabId'), tabId: str('Tab id (limits to that tab)'), last: int('Max entries (default 100)'), level: str('console level: log, info, warning, error, debug'), since: int('Only events with seq greater than this'), types: { type: 'array', items: { type: 'string', enum: EVENT_TYPES }, description: 'Event types (default console, pageerror, dialog)' } }),
    rest: [{ method: 'GET', path: '/v1/tabs/{tabId}/console' }, { method: 'GET', path: '/v1/profiles/{profileId}/console' }],
    handler: async (a) => ({ events: automation.consoleRead({ profileId: a.profileId, tabId: a.tabId }, { last: a.last, level: a.level, since: a.since, types: a.types }) })
  },
  {
    name: 'facet_console_clear',
    description: 'Clear the recorded console/pageerror/dialog events of a profile.',
    inputSchema: obj({ profileId: str('Profile id; or pass tabId'), tabId: str('Tab id') }),
    rest: [{ method: 'DELETE', path: '/v1/tabs/{tabId}/console' }, { method: 'DELETE', path: '/v1/profiles/{profileId}/console' }],
    handler: async (a) => automation.consoleClear({ profileId: a.profileId, tabId: a.tabId })
  },

  // Network
  {
    name: 'facet_network_list',
    description: 'Requests recorded for a tab or profile (last 2000): requestId, method, url, status, resourceType, size, timing. Filter by url substring or /regex/, method, status, type.',
    inputSchema: obj({ profileId: str('Profile id; or pass tabId'), tabId: str('Tab id'), url: str('URL substring or /regex/i'), method: str('HTTP method'), status: int('HTTP status'), type: str('resourceType: document, xhr, fetch, script, image, ...'), last: int('Max entries (default 100)') }),
    rest: [{ method: 'GET', path: '/v1/tabs/{tabId}/network' }, { method: 'GET', path: '/v1/profiles/{profileId}/network' }],
    handler: async (a) => ({ requests: automation.networkList({ profileId: a.profileId, tabId: a.tabId }, { url: a.url, method: a.method, status: a.status, type: a.type, last: a.last }) })
  },
  {
    name: 'facet_network_get_body',
    description: 'Response body of a recorded request (text for textual content types, base64 otherwise; capped at 2 MB).',
    inputSchema: obj({ requestId: str('requestId from facet_network_list') }, ['requestId']),
    rest: [{ method: 'GET', path: '/v1/network/{requestId}/body' }],
    handler: async (a) => automation.networkBody(a.requestId)
  },

  // Cookies
  {
    name: 'facet_cookies_get',
    description: 'Cookies of a profile (running or not), optionally only those that apply to the given URLs.',
    inputSchema: obj({ profileId, urls: { type: 'array', items: { type: 'string' }, description: 'Only cookies for these URLs' } }, ['profileId']),
    rest: [{ method: 'GET', path: '/v1/profiles/{profileId}/cookies' }],
    handler: async (a) => ({ cookies: await automation.cookiesGet(a.profileId, a.urls) })
  },
  {
    name: 'facet_cookies_set',
    description: 'Add or overwrite cookies in a profile. Each cookie needs name, value and domain; path defaults to /, expires -1 = session.',
    inputSchema: obj({ profileId, cookies: { type: 'array', description: 'Cookie records', items: { type: 'object', properties: { name: str('name'), value: str('value'), domain: str('domain'), path: str('path'), expires: num('unix seconds, -1 for session'), httpOnly: bool('httpOnly'), secure: bool('secure'), sameSite: enumOf('sameSite', ['Strict', 'Lax', 'None']) }, required: ['name', 'value', 'domain'] } } }, ['profileId', 'cookies']),
    rest: [{ method: 'PUT', path: '/v1/profiles/{profileId}/cookies' }],
    handler: async (a) => automation.cookiesSet(a.profileId, a.cookies)
  },
  {
    name: 'facet_cookies_clear',
    description: 'Delete all cookies of a profile.',
    inputSchema: obj({ profileId }, ['profileId']),
    rest: [{ method: 'DELETE', path: '/v1/profiles/{profileId}/cookies' }],
    handler: async (a) => automation.cookiesClear(a.profileId)
  },

  // Raw CDP
  {
    name: 'facet_cdp_send',
    description: 'Send a raw Chrome DevTools Protocol command. With tabId it goes to that page\'s session (Network.*, DOM.*, Emulation.*, Performance.* ...); with profileId only, to the browser-level session. Target.* and Browser.close are refused.',
    inputSchema: obj({ tabId: str('Tab id for a page session'), profileId: str('Profile id for a browser session (when no tabId)'), method: str('CDP method, e.g. "Network.emulateNetworkConditions"'), params: { type: 'object', description: 'CDP params' } }, ['method']),
    rest: [{ method: 'POST', path: '/v1/tabs/{tabId}/cdp' }, { method: 'POST', path: '/v1/profiles/{profileId}/cdp' }],
    handler: async (a) => ({ result: await automation.cdpSend({ tabId: a.tabId, profileId: a.profileId }, a.method, a.params) })
  }
]

const byName = new Map(tools.map((t) => [t.name, t]))

export function toolByName(name: string): ToolDef | undefined {
  return byName.get(name)
}

// ---- REST routing -------------------------------------------------------

interface CompiledRoute {
  tool: ToolDef
  method: string
  re: RegExp
  keys: string[]
}

const routes: CompiledRoute[] = tools.flatMap((tool) =>
  tool.rest.map((r) => {
    const keys: string[] = []
    const re = new RegExp('^' + r.path.replace(/\{(\w+)\}/g, (_m, k: string) => { keys.push(k); return '([^/]+)' }) + '/?$')
    return { tool, method: r.method, re, keys }
  })
)

export function matchRoute(method: string, pathname: string): { tool: ToolDef; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method) continue
    const m = r.re.exec(pathname)
    if (!m) continue
    const params: Record<string, string> = {}
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
    return { tool: r.tool, params }
  }
  return null
}

export function knownPath(pathname: string): boolean {
  return routes.some((r) => r.re.test(pathname))
}

// Query-string and path values arrive as strings; coerce them by schema type.
export function coerceArgs(tool: ToolDef, raw: Record<string, unknown>): Record<string, unknown> {
  const props = (tool.inputSchema.properties || {}) as Record<string, JsonSchema>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    const schema = props[k]
    if (!schema || typeof v !== 'string') {
      out[k] = v
      continue
    }
    const type = schema.type
    if (type === 'integer' || type === 'number') out[k] = v === '' ? undefined : Number(v)
    else if (type === 'boolean') out[k] = v === 'true' || v === '1'
    else if (type === 'array') out[k] = v.split(',').map((s) => s.trim()).filter(Boolean)
    else if (type === 'object') {
      try { out[k] = JSON.parse(v) } catch { out[k] = v }
    } else out[k] = v
  }
  return out
}

// Minimal structural check, so a wrong call fails with a message naming the
// field instead of a Playwright stack. Full JSON Schema validation is not
// needed for the handful of types used here.
export function validateArgs(tool: ToolDef, args: Record<string, unknown>): string | null {
  const schema = tool.inputSchema
  const props = (schema.properties || {}) as Record<string, JsonSchema>
  for (const req of (schema.required as string[]) || []) {
    if (args[req] === undefined || args[req] === null || args[req] === '') return `Missing required field "${req}"`
  }
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) continue
    const p = props[k]
    if (!p) return `Unknown field "${k}" for ${tool.name}`
    const t = p.type as string | undefined
    if (!t) continue
    if (t === 'string' && typeof v !== 'string') return `"${k}" must be a string`
    if ((t === 'integer' || t === 'number') && (typeof v !== 'number' || Number.isNaN(v))) return `"${k}" must be a number`
    if (t === 'boolean' && typeof v !== 'boolean') return `"${k}" must be a boolean`
    if (t === 'array' && !Array.isArray(v)) return `"${k}" must be an array`
    if (t === 'object' && (typeof v !== 'object' || v === null || Array.isArray(v))) return `"${k}" must be an object`
    if (Array.isArray(p.enum) && !(p.enum as unknown[]).includes(v)) return `"${k}" must be one of ${(p.enum as string[]).join(', ')}`
  }
  return null
}

// ---- OpenAPI ------------------------------------------------------------

export function openapi(port: number, version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const tool of tools) {
    for (const r of tool.rest) {
      const pathKeys = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
      const props = { ...((tool.inputSchema.properties || {}) as Record<string, JsonSchema>) }
      const required = ((tool.inputSchema.required as string[]) || []).filter((k) => !pathKeys.includes(k))
      const parameters = pathKeys.map((k) => ({ name: k, in: 'path', required: true, schema: { type: 'string' }, description: (props[k]?.description as string) || k }))
      for (const k of pathKeys) delete props[k]
      const op: Record<string, unknown> = { operationId: tool.name, summary: tool.description, tags: [tool.name.split('_')[1]], parameters, responses: { '200': { description: 'Result JSON' }, '400': { description: 'Bad input' }, '401': { description: 'Missing or wrong bearer token' }, '404': { description: 'Profile, tab or request not found' } } }
      if (r.method === 'GET' || r.method === 'DELETE') {
        ;(op.parameters as unknown[]).push(...Object.entries(props).map(([k, s]) => ({ name: k, in: 'query', required: required.includes(k), schema: s.type === 'array' || s.type === 'object' ? { type: 'string' } : s, description: s.description })))
      } else if (Object.keys(props).length) {
        op.requestBody = { required: required.length > 0, content: { 'application/json': { schema: { type: 'object', properties: props, required } } } }
      }
      paths[r.path] = paths[r.path] || {}
      paths[r.path][r.method.toLowerCase()] = op
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: 'FacetBrowser Automation API', version, description: 'Local API for driving FacetBrowser profiles. Bearer token from Settings > Automation or %APPDATA%/FacetBrowser/automation.json. WebSocket event stream at /v1/events?profile=&types=.' },
    servers: [{ url: `http://127.0.0.1:${port}` }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearer: [] }],
    paths
  }
}
