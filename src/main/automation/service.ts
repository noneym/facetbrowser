import { EventEmitter } from 'events'
import type { BrowserContext, CDPSession, Dialog, Locator, Page, Request } from 'playwright-core'
import type { CookieRecord, Profile, ProxyCheckResult, ProxyConfig, RunningProfile } from '@shared/types'
import type { AutomationProfileInfo, NetworkRecord, TabInfo } from '@shared/automation'
import { store } from '../store'
import { launcher } from '../browser/launcher'
import { sync } from '../cloud/sync'
import { extensions } from '../extensions'
import { quickGeo } from '../proxy/checker'
import { COUNTRY_LOCALES } from '../fingerprint/data'
import { events, BODY_MAX, type EventFilter, type NetworkFilter } from './events'
import { takeSnapshot, findInPage, type SnapshotOptions } from './snapshot'

// One entry point for driving profiles, used by the renderer (through the
// thin IPC handlers), the REST/WS server and later the MCP server. Holds the
// tab registry (tabId <-> Playwright Page), captures page events into the
// event hub, and implements every action an agent can take.
//
// Anti-detect rule: nothing is injected into pages at load. `evaluate` runs
// only when called, through Playwright's own Runtime.evaluate.

export class AutomationError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message)
  }
}

export interface Target {
  ref?: string // from facet_snapshot / facet_find, e.g. "e12"
  selector?: string // CSS, text=, role=, xpath=
}

interface TabEntry {
  tabId: string
  profileId: string
  page: Page
  cdp: CDPSession | null
  pendingDialog: Dialog | null
  lastScreenshotAt: number
}

const EVALUATE_MAX = 1024 * 1024
const SCREENSHOT_GAP_MS = 200
const DEFAULT_TIMEOUT = 15000
const CDP_DENY = [/^Target\./, /^Browser\.(close|crash|crashGpuProcess)$/]

// Timezone, language and location follow the proxy's exit country. A proxy
// that was never checked (or whose result is a day old) gets a one-request
// geo lookup at launch; the result is kept on the saved proxy.
const GEO_MAX_AGE_MS = 24 * 3600000
async function freshProxyInfo(profile: Profile, config: ProxyConfig | null, known?: ProxyCheckResult): Promise<ProxyCheckResult | undefined> {
  if (!config) return undefined
  const usable = known && known.timezone && known.countryCode && Date.now() - known.checkedAt < GEO_MAX_AGE_MS
  if (usable) return known
  const geo = await quickGeo(config)
  if (!geo) return known
  const merged: ProxyCheckResult = { ...(known || {}), ...geo, checkedAt: known?.checkedAt && Date.now() - known.checkedAt < GEO_MAX_AGE_MS ? known.checkedAt : geo.checkedAt }
  if (profile.proxy.mode === 'saved' && profile.proxy.savedId) {
    const saved = store().getProxy(profile.proxy.savedId)
    if (saved) store().upsertProxy({ ...saved, lastCheck: merged })
  }
  return merged
}

// localeMode 'auto' (the default): locale and languages are set from the
// proxy country before launch and persisted so the editor shows them.
function applyProxyLocale(profile: Profile, info?: ProxyCheckResult): void {
  const fp = profile.fingerprint
  if (fp.localeMode === 'manual' || !info?.countryCode) return
  // Unknown country: English is a safer default than the host's own locale.
  const loc = COUNTRY_LOCALES[info.countryCode] || COUNTRY_LOCALES['US']
  if (fp.locale === loc.locale && JSON.stringify(fp.languages) === JSON.stringify(loc.languages)) return
  fp.locale = loc.locale
  fp.languages = loc.languages
  store().upsertProfile(profile, { keepUpdatedAt: true })
}

export function resolveProxy(profile: Profile): { config: ProxyConfig | null; info?: ProxyCheckResult } {
  const s = store()
  if (profile.proxy.mode === 'saved' && profile.proxy.savedId) {
    const p = s.getProxy(profile.proxy.savedId)
    if (!p) return { config: null }
    return { config: { protocol: p.protocol, host: p.host, port: p.port, username: p.username, password: p.password }, info: p.lastCheck }
  }
  if (profile.proxy.mode === 'custom' && profile.proxy.custom) return { config: profile.proxy.custom }
  return { config: null }
}

function newTabId(): string {
  return 't_' + Math.random().toString(36).slice(2, 8)
}

function mainUrl(page: Page): string {
  try {
    return page.url()
  } catch {
    return ''
  }
}

function isTextual(contentType: string): boolean {
  return /^text\/|json|javascript|ecmascript|xml|html|x-www-form-urlencoded|svg|csv|yaml|graphql/i.test(contentType)
}

class AutomationService extends EventEmitter {
  private tabs = new Map<string, TabEntry>()
  private byPage = new WeakMap<Page, string>()
  private requestIds = new WeakMap<Request, string>()
  private active = new Map<string, string>() // profileId -> tabId
  private browserCdp = new Map<string, CDPSession>()

  constructor() {
    super()
    launcher.on('page', (profileId: string, page: Page) => this.trackPage(profileId, page))
    launcher.on('closed', (profileId: string) => this.onProfileClosed(profileId))
  }

  // ---- profiles ---------------------------------------------------------

  listProfiles(): AutomationProfileInfo[] {
    const s = store()
    const running = new Map(launcher.list().map((r) => [r.profileId, r]))
    return s.profiles.map((p) => this.describe(p, running.get(p.id)))
  }

  profileInfo(idOrName: string): AutomationProfileInfo {
    const p = this.resolveProfile(idOrName)
    const run = launcher.list().find((r) => r.profileId === p.id)
    return this.describe(p, run)
  }

  private describe(p: Profile, run?: RunningProfile): AutomationProfileInfo {
    const s = store()
    const proxy: AutomationProfileInfo['proxy'] = { mode: p.proxy.mode }
    if (p.proxy.mode === 'saved' && p.proxy.savedId) {
      const sp = s.getProxy(p.proxy.savedId)
      if (sp) {
        proxy.host = sp.host
        proxy.country = sp.lastCheck?.countryCode
      }
    } else if (p.proxy.mode === 'custom' && p.proxy.custom) proxy.host = p.proxy.custom.host
    const group = p.groupId ? s.groups.find((g) => g.id === p.groupId)?.name : undefined
    return {
      id: p.id,
      name: p.name,
      groupId: p.groupId,
      group,
      tags: p.tags,
      proxy,
      state: run ? run.state : 'idle',
      tabs: run?.state === 'running' ? this.tabsOf(p.id).length : 0,
      startedAt: run?.startedAt,
      cdpUrl: launcher.cdpUrlOf(p.id)
    }
  }

  // Accepts a profile id or (unique) name, so an agent can say "launch Shop EU".
  resolveProfile(idOrName: string): Profile {
    const s = store()
    const byId = s.getProfile(idOrName)
    if (byId) return byId
    const q = idOrName.trim().toLowerCase()
    const matches = s.profiles.filter((p) => p.name.trim().toLowerCase() === q)
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) throw new AutomationError('ambiguous_profile', `Several profiles are named "${idOrName}"; use the id from facet_list_profiles`, 400)
    throw new AutomationError('profile_not_found', `Profile "${idOrName}" not found; call facet_list_profiles`, 404)
  }

  // Was the `browser:launch` IPC handler. force: the profile is open on
  // another device and the user chose "Force stop"; wait for that device to
  // close it and upload its session first.
  async launchProfile(idOrName: string, force?: boolean): Promise<Profile> {
    const s = store()
    const id = this.resolveProfile(idOrName).id
    const gate = sync.licenseGate()
    if (!gate.ok) throw new AutomationError('license', gate.reason || 'license', 403)
    if (!launcher.isRunning(id)) {
      if (force) await sync.takeOver(id)
      else await sync.claim(id)
      // Pull the profile as the last device left it (its open tabs, edits
      // made on the phone) instead of waiting for the next periodic sync.
      await sync.runNow()
    }
    const p = s.getProfile(id)
    if (!p) throw new AutomationError('profile_not_found', 'Profile not found', 404)
    await sync.pullCookiesIfNewer(id).catch(() => {})
    extensions.applyShares(p)
    try {
      const { config, info: known } = resolveProxy(p)
      const info = await freshProxyInfo(p, config, known)
      applyProxyLocale(p, info)
      await launcher.launch({ profile: p, proxy: config, proxyInfo: info, settings: s.settings, extensionDirs: extensions.dirsFor(p), exposeCdp: !!s.settings.automation?.exposeCdp })
    } catch (e) {
      if (!launcher.isRunning(id)) await sync.releaseLock(id)
      throw e
    }
    p.launchCount = (p.launchCount || 0) + 1
    p.lastLaunchedAt = Date.now()
    s.upsertProfile(p)
    return p
  }

  async stopProfile(idOrName: string): Promise<void> {
    const id = store().getProfile(idOrName) ? idOrName : this.resolveProfile(idOrName).id
    await launcher.stop(id)
  }

  stopAll(): Promise<void> {
    return launcher.stopAll()
  }

  private requireContext(profileId: string): BrowserContext {
    const ctx = launcher.contextOf(profileId)
    if (!ctx) throw new AutomationError('profile_not_running', `Profile ${profileId} is not running; call facet_launch_profile`, 409)
    return ctx
  }

  private onProfileClosed(profileId: string): void {
    for (const [tabId, t] of [...this.tabs]) {
      if (t.profileId === profileId) this.tabs.delete(tabId)
    }
    this.active.delete(profileId)
    this.browserCdp.delete(profileId)
    events.release(profileId)
    events.push(profileId, null, 'close', { profile: true })
  }

  // ---- tabs -------------------------------------------------------------

  private trackPage(profileId: string, page: Page): void {
    if (this.byPage.has(page)) return
    const tabId = newTabId()
    const entry: TabEntry = { tabId, profileId, page, cdp: null, pendingDialog: null, lastScreenshotAt: 0 }
    this.tabs.set(tabId, entry)
    this.byPage.set(page, tabId)
    if (!this.active.has(profileId)) this.active.set(profileId, tabId)
    events.push(profileId, tabId, 'page', { url: mainUrl(page) })

    page.on('console', (msg) => {
      const loc = msg.location()
      events.push(profileId, tabId, 'console', { level: msg.type(), text: msg.text(), url: loc.url, line: loc.lineNumber, column: loc.columnNumber })
    })
    page.on('pageerror', (err) => events.push(profileId, tabId, 'pageerror', { message: err.message, stack: err.stack }))
    // With a dialog listener attached, Playwright leaves alert/confirm/prompt
    // open (visible to the user, answerable by facet_handle_dialog) instead of
    // dismissing it before anyone sees it.
    page.on('dialog', (d) => {
      entry.pendingDialog = d
      events.push(profileId, tabId, 'dialog', { kind: d.type(), message: d.message(), defaultValue: d.defaultValue() })
    })
    page.on('framenavigated', (f) => {
      if (f.parentFrame()) return
      events.push(profileId, tabId, 'framenavigated', { url: f.url() })
    })
    page.on('request', (req) => {
      const requestId = events.newRequestId()
      this.requestIds.set(req, requestId)
      const record: NetworkRecord = { requestId, profileId, tabId, method: req.method(), url: req.url(), resourceType: req.resourceType(), requestHeaders: req.headers(), startedAt: Date.now() }
      events.recordRequest(record)
      events.push(profileId, tabId, 'request', { requestId, method: record.method, url: record.url, resourceType: record.resourceType })
    })
    page.on('response', (res) => {
      const requestId = this.requestIds.get(res.request())
      if (!requestId) return
      const headers = res.headers()
      const size = Number(headers['content-length'] || 0) || undefined
      events.updateRequest(profileId, requestId, { status: res.status(), statusText: res.statusText(), ok: res.ok(), responseHeaders: headers, size }, res)
      events.push(profileId, tabId, 'response', { requestId, status: res.status(), url: res.url() })
    })
    page.on('requestfinished', (req) => {
      const requestId = this.requestIds.get(req)
      if (!requestId) return
      const now = Date.now()
      const rec = events.networkRecord(requestId)?.record
      events.updateRequest(profileId, requestId, { finishedAt: now, durationMs: rec ? now - rec.startedAt : undefined })
    })
    page.on('requestfailed', (req) => {
      const requestId = this.requestIds.get(req)
      if (!requestId) return
      const failure = req.failure()?.errorText || 'failed'
      events.updateRequest(profileId, requestId, { failure, finishedAt: Date.now() })
      events.push(profileId, tabId, 'requestfailed', { requestId, url: req.url(), failure })
    })
    page.on('close', () => {
      this.tabs.delete(tabId)
      if (this.active.get(profileId) === tabId) {
        const next = this.tabsOf(profileId)[0]
        if (next) this.active.set(profileId, next.tabId)
        else this.active.delete(profileId)
      }
      entry.cdp?.detach().catch(() => {})
      entry.cdp = null
      events.push(profileId, tabId, 'close', { url: mainUrl(page) })
    })
  }

  private tabsOf(profileId: string): TabEntry[] {
    return [...this.tabs.values()].filter((t) => t.profileId === profileId && !t.page.isClosed())
  }

  tab(tabId: string): TabEntry {
    const t = this.tabs.get(tabId)
    if (!t || t.page.isClosed()) throw new AutomationError('tab_not_found', `Tab ${tabId} not found; call facet_list_tabs`, 404)
    return t
  }

  tabIdOf(page: Page): string | undefined {
    return this.byPage.get(page)
  }

  async listTabs(profileId: string): Promise<TabInfo[]> {
    const p = this.resolveProfile(profileId)
    this.requireContext(p.id)
    const active = this.active.get(p.id)
    const out: TabInfo[] = []
    for (const t of this.tabsOf(p.id)) {
      const url = mainUrl(t.page)
      // chrome:// helper pages opened by the launcher are not the agent's business.
      if (url.startsWith('chrome://settings')) continue
      out.push({ tabId: t.tabId, profileId: p.id, url, title: await t.page.title().catch(() => ''), active: t.tabId === active })
    }
    return out
  }

  async tabInfo(tabId: string): Promise<TabInfo> {
    const t = this.tab(tabId)
    return { tabId, profileId: t.profileId, url: mainUrl(t.page), title: await t.page.title().catch(() => ''), active: this.active.get(t.profileId) === tabId }
  }

  async newTab(profileId: string, url?: string): Promise<TabInfo> {
    const p = this.resolveProfile(profileId)
    const ctx = this.requireContext(p.id)
    const page = await ctx.newPage()
    // The launcher's 'page' event has fired synchronously inside newPage().
    const tabId = this.byPage.get(page)
    if (!tabId) throw new AutomationError('internal', 'New tab was not registered', 500)
    this.active.set(p.id, tabId)
    if (url) await page.goto(url, { timeout: DEFAULT_TIMEOUT, waitUntil: 'domcontentloaded' }).catch((e) => { throw new AutomationError('navigation_failed', (e as Error).message, 400) })
    return this.tabInfo(tabId)
  }

  async closeTab(tabId: string): Promise<void> {
    const t = this.tab(tabId)
    await t.page.close()
  }

  async selectTab(tabId: string): Promise<TabInfo> {
    const t = this.tab(tabId)
    await t.page.bringToFront()
    this.active.set(t.profileId, tabId)
    return this.tabInfo(tabId)
  }

  // ---- navigation -------------------------------------------------------

  async navigate(tabId: string, url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' = 'load', timeoutMs = DEFAULT_TIMEOUT * 2): Promise<{ url: string; title: string; status: number | null }> {
    const t = this.tab(tabId)
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url
    const res = await t.page.goto(url, { waitUntil, timeout: timeoutMs }).catch((e) => { throw new AutomationError('navigation_failed', (e as Error).message, 400) })
    return { url: mainUrl(t.page), title: await t.page.title().catch(() => ''), status: res?.status() ?? null }
  }

  async goBack(tabId: string, timeoutMs = DEFAULT_TIMEOUT): Promise<TabInfo> {
    const t = this.tab(tabId)
    await t.page.goBack({ timeout: timeoutMs }).catch(() => null)
    return this.tabInfo(tabId)
  }

  async goForward(tabId: string, timeoutMs = DEFAULT_TIMEOUT): Promise<TabInfo> {
    const t = this.tab(tabId)
    await t.page.goForward({ timeout: timeoutMs }).catch(() => null)
    return this.tabInfo(tabId)
  }

  async reload(tabId: string, timeoutMs = DEFAULT_TIMEOUT * 2): Promise<TabInfo> {
    const t = this.tab(tabId)
    await t.page.reload({ timeout: timeoutMs }).catch((e) => { throw new AutomationError('navigation_failed', (e as Error).message, 400) })
    return this.tabInfo(tabId)
  }

  async waitFor(tabId: string, opts: { selector?: string; text?: string; url?: string; state?: 'attached' | 'visible' | 'hidden' | 'detached'; loadState?: 'load' | 'domcontentloaded' | 'networkidle'; timeMs?: number; timeoutMs?: number }): Promise<{ ok: true; waitedMs: number }> {
    const t = this.tab(tabId)
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT
    const started = Date.now()
    try {
      if (opts.selector) await t.page.locator(opts.selector).first().waitFor({ state: opts.state || 'visible', timeout })
      if (opts.text) await t.page.getByText(opts.text).first().waitFor({ state: opts.state || 'visible', timeout })
      if (opts.url) await t.page.waitForURL(opts.url.includes('*') ? opts.url : (u) => u.href.includes(opts.url!), { timeout })
      if (opts.loadState) await t.page.waitForLoadState(opts.loadState, { timeout })
      if (opts.timeMs) await new Promise((r) => setTimeout(r, Math.min(opts.timeMs!, 60000)))
    } catch (e) {
      throw new AutomationError('timeout', (e as Error).message, 408)
    }
    return { ok: true, waitedMs: Date.now() - started }
  }

  // ---- reading ----------------------------------------------------------

  snapshot(tabId: string, opts: SnapshotOptions = {}): ReturnType<typeof takeSnapshot> {
    const t = this.tab(tabId)
    return takeSnapshot(t.page, opts)
  }

  find(tabId: string, query: string, limit?: number): ReturnType<typeof findInPage> {
    const t = this.tab(tabId)
    return findInPage(t.page, query, limit)
  }

  async getText(tabId: string, target?: Target, maxChars = 20000): Promise<{ text: string; truncated: boolean; length: number }> {
    const t = this.tab(tabId)
    const loc = target && (target.ref || target.selector) ? this.locate(t, target) : t.page.locator('body')
    const text = await loc.innerText({ timeout: DEFAULT_TIMEOUT }).catch((e) => { throw new AutomationError('element', (e as Error).message, 400) })
    return clipText(text, maxChars)
  }

  async getHtml(tabId: string, target?: Target, maxChars = 50000): Promise<{ text: string; truncated: boolean; length: number }> {
    const t = this.tab(tabId)
    let html: string
    if (target && (target.ref || target.selector)) {
      html = await this.locate(t, target).evaluate((el) => (el as unknown as { outerHTML: string }).outerHTML, undefined, { timeout: DEFAULT_TIMEOUT }).catch((e) => { throw new AutomationError('element', (e as Error).message, 400) })
    } else {
      html = await t.page.content()
    }
    return clipText(html, maxChars)
  }

  async screenshot(tabId: string, opts: { fullPage?: boolean; format?: 'png' | 'jpeg'; quality?: number; clip?: { x: number; y: number; width: number; height: number } } & Target = {}): Promise<{ format: string; base64: string; bytes: number }> {
    const t = this.tab(tabId)
    // At most one shot per 200 ms per tab; a burst waits instead of failing.
    const wait = t.lastScreenshotAt + SCREENSHOT_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    t.lastScreenshotAt = Date.now()
    const type = opts.format === 'jpeg' ? 'jpeg' : 'png'
    const common = { type, quality: type === 'jpeg' ? opts.quality ?? 80 : undefined, timeout: DEFAULT_TIMEOUT } as const
    let buf: Buffer
    try {
      if (opts.ref || opts.selector) buf = await this.locate(t, opts).screenshot(common)
      else buf = await t.page.screenshot({ ...common, fullPage: !!opts.fullPage, clip: opts.clip })
    } catch (e) {
      throw new AutomationError('screenshot_failed', (e as Error).message, 400)
    }
    return { format: type, base64: buf.toString('base64'), bytes: buf.length }
  }

  // ---- interaction ------------------------------------------------------

  private locate(t: TabEntry, target: Target): Locator {
    if (target.ref) return t.page.getByRef(target.ref)
    if (target.selector) return t.page.locator(target.selector).first()
    throw new AutomationError('bad_target', 'Pass ref (from facet_snapshot) or selector', 400)
  }

  private async act<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof AutomationError) throw e
      const msg = (e as Error).message || String(e)
      const code = /Timeout/i.test(msg) ? 'timeout' : /not found|no element|resolved to/i.test(msg) ? 'element_not_found' : 'action_failed'
      throw new AutomationError(code, msg.split('\n').slice(0, 6).join('\n'), code === 'timeout' ? 408 : 400)
    }
  }

  click(tabId: string, target: Target, opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number; modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>; timeoutMs?: number } = {}): Promise<{ ok: true }> {
    const t = this.tab(tabId)
    return this.act(async () => {
      await this.locate(t, target).click({ button: opts.button, clickCount: opts.clickCount, modifiers: opts.modifiers, timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT })
      return { ok: true as const }
    })
  }

  hover(tabId: string, target: Target, timeoutMs = DEFAULT_TIMEOUT): Promise<{ ok: true }> {
    const t = this.tab(tabId)
    return this.act(async () => {
      await this.locate(t, target).hover({ timeout: timeoutMs })
      return { ok: true as const }
    })
  }

  // Keystroke by keystroke (optionally at human speed); `fill` sets the value at once.
  type(tabId: string, target: Target, text: string, opts: { clear?: boolean; pressEnter?: boolean; delayMs?: number; timeoutMs?: number } = {}): Promise<{ ok: true }> {
    const t = this.tab(tabId)
    return this.act(async () => {
      const loc = this.locate(t, target)
      const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT
      if (opts.clear) {
        await loc.fill('', { timeout }).catch(async () => {
          await loc.click({ timeout })
          await loc.press('Control+A', { timeout })
          await loc.press('Backspace', { timeout })
        })
      }
      await loc.pressSequentially(text, { delay: opts.delayMs ?? 0, timeout })
      if (opts.pressEnter) await loc.press('Enter', { timeout })
      return { ok: true as const }
    })
  }

  fill(tabId: string, target: Target, value: string | number | boolean | string[], timeoutMs = DEFAULT_TIMEOUT): Promise<{ ok: true; kind: string }> {
    const t = this.tab(tabId)
    return this.act(async () => {
      const loc = this.locate(t, target)
      const kind = await loc.evaluate((el) => {
        const e = el as unknown as { tagName: string; type?: string }
        const tag = e.tagName.toLowerCase()
        if (tag === 'select') return 'select'
        if (tag === 'input' && (e.type === 'checkbox' || e.type === 'radio')) return 'checkbox'
        return 'text'
      }, undefined, { timeout: timeoutMs })
      if (kind === 'checkbox') await loc.setChecked(value === true || value === 'true' || value === 1 || value === '1' || value === 'on', { timeout: timeoutMs })
      else if (kind === 'select') await loc.selectOption(Array.isArray(value) ? value : String(value), { timeout: timeoutMs })
      else await loc.fill(String(value), { timeout: timeoutMs })
      return { ok: true as const, kind }
    })
  }

  // "Enter", "Control+A", or a space-separated sequence "Tab Tab Enter".
  press(tabId: string, keys: string, target?: Target, timeoutMs = DEFAULT_TIMEOUT): Promise<{ ok: true }> {
    const t = this.tab(tabId)
    return this.act(async () => {
      const seq = keys.trim().split(/\s+/).filter(Boolean)
      for (const k of seq) {
        if (target && (target.ref || target.selector)) await this.locate(t, target).press(k, { timeout: timeoutMs })
        else await t.page.keyboard.press(k)
      }
      return { ok: true as const }
    })
  }

  scroll(tabId: string, opts: { direction?: 'up' | 'down' | 'left' | 'right'; amount?: number } & Target = {}): Promise<{ ok: true }> {
    const t = this.tab(tabId)
    return this.act(async () => {
      if (opts.ref || opts.selector) {
        await this.locate(t, opts).scrollIntoViewIfNeeded({ timeout: DEFAULT_TIMEOUT })
        return { ok: true as const }
      }
      const amount = opts.amount ?? 600
      const dir = opts.direction || 'down'
      const dx = dir === 'left' ? -amount : dir === 'right' ? amount : 0
      const dy = dir === 'up' ? -amount : dir === 'down' ? amount : 0
      await t.page.mouse.wheel(dx, dy)
      return { ok: true as const }
    })
  }

  async handleDialog(tabId: string, accept: boolean, promptText?: string): Promise<{ ok: true; kind: string; message: string }> {
    const t = this.tab(tabId)
    const d = t.pendingDialog
    if (!d) throw new AutomationError('no_dialog', 'No dialog is open on this tab', 404)
    t.pendingDialog = null
    try {
      if (accept) await d.accept(promptText)
      else await d.dismiss()
    } catch (e) {
      throw new AutomationError('dialog', (e as Error).message, 400)
    }
    return { ok: true, kind: d.type(), message: d.message() }
  }

  // ---- javascript -------------------------------------------------------

  // Runs now, in the page, via Runtime.evaluate; nothing is left behind.
  // `expression` is evaluated as is; `function` is a function source applied
  // to `args`. Promises are awaited. Result is JSON, capped at 1 MB.
  async evaluate(tabId: string, input: { expression?: string; function?: string; args?: unknown[]; timeoutMs?: number } & Target): Promise<{ value: unknown; truncated?: boolean }> {
    const t = this.tab(tabId)
    let expression: string
    if (input.function) expression = `(${input.function}).apply(null, ${JSON.stringify(input.args || [])})`
    else if (input.expression) expression = input.expression
    else throw new AutomationError('bad_input', 'Pass expression or function', 400)
    const timeout = Math.min(input.timeoutMs ?? 30000, 120000)
    let value: unknown
    try {
      // With a target, `el` is the element inside the expression.
      const onElement = (el: unknown, src: string): unknown => eval(src) // eslint-disable-line no-eval
      const run = input.ref || input.selector
        ? this.locate(t, input).evaluate(onElement, expression, { timeout })
        : t.page.evaluate(expression)
      value = await Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(new Error(`evaluate timed out after ${timeout} ms`)), timeout))])
    } catch (e) {
      const msg = (e as Error).message || String(e)
      throw new AutomationError(/timed out/i.test(msg) ? 'timeout' : 'evaluate_failed', msg.split('\n').slice(0, 12).join('\n'), /timed out/i.test(msg) ? 408 : 400)
    }
    if (value === undefined) value = null
    const json = JSON.stringify(value)
    if (json && json.length > EVALUATE_MAX) return { value: json.slice(0, EVALUATE_MAX), truncated: true }
    return { value }
  }

  // ---- console / network ------------------------------------------------

  consoleRead(scope: { profileId?: string; tabId?: string }, opts: { last?: number; level?: string; since?: number; types?: EventFilter['types'] } = {}): ReturnType<typeof events.list> {
    const { profileId, tabId } = this.scope(scope)
    const list = events.list(profileId, { tabId, since: opts.since, types: opts.types && opts.types.length ? opts.types : ['console', 'pageerror', 'dialog'] })
    const filtered = opts.level ? list.filter((e) => e.type !== 'console' || e.data.level === opts.level) : list
    const last = opts.last ?? 100
    return filtered.length > last ? filtered.slice(filtered.length - last) : filtered
  }

  consoleClear(scope: { profileId?: string; tabId?: string }): { ok: true } {
    const { profileId } = this.scope(scope)
    events.clear(profileId, ['console', 'pageerror', 'dialog'])
    return { ok: true }
  }

  networkList(scope: { profileId?: string; tabId?: string }, f: Omit<NetworkFilter, 'tabId'> = {}): NetworkRecord[] {
    const { profileId, tabId } = this.scope(scope)
    return events.networkList(profileId, { ...f, tabId, last: f.last ?? 100 })
  }

  async networkBody(requestId: string): Promise<{ requestId: string; url: string; status?: number; contentType: string; encoding: 'utf8' | 'base64'; size: number; truncated: boolean; body: string }> {
    const e = events.networkRecord(requestId)
    if (!e) throw new AutomationError('request_not_found', `Request ${requestId} not found (ring buffer holds the last 2000 per profile); call facet_network_list`, 404)
    if (!e.response) throw new AutomationError('no_response', e.record.failure ? `Request failed: ${e.record.failure}` : 'No response yet', 409)
    let buf: Buffer
    try {
      buf = await e.response.body()
    } catch (err) {
      throw new AutomationError('body_unavailable', (err as Error).message, 410)
    }
    const contentType = e.record.responseHeaders?.['content-type'] || ''
    const truncated = buf.length > BODY_MAX
    const slice = truncated ? buf.subarray(0, BODY_MAX) : buf
    const textual = isTextual(contentType)
    return { requestId, url: e.record.url, status: e.record.status, contentType, encoding: textual ? 'utf8' : 'base64', size: buf.length, truncated, body: textual ? slice.toString('utf8') : slice.toString('base64') }
  }

  private scope(s: { profileId?: string; tabId?: string }): { profileId: string; tabId?: string } {
    if (s.tabId) {
      const t = this.tabs.get(s.tabId)
      if (!t) throw new AutomationError('tab_not_found', `Tab ${s.tabId} not found; call facet_list_tabs`, 404)
      return { profileId: t.profileId, tabId: s.tabId }
    }
    if (s.profileId) return { profileId: this.resolveProfile(s.profileId).id }
    throw new AutomationError('bad_input', 'Pass profileId or tabId', 400)
  }

  // ---- cookies ----------------------------------------------------------
  // Live context while running, otherwise a short headless open of the
  // profile directory (same as the Cookies dialog in the app).

  async cookiesGet(profileId: string, urls?: string[]): Promise<CookieRecord[]> {
    const p = this.resolveProfile(profileId)
    const ctx = launcher.contextOf(p.id)
    if (ctx) return (await ctx.cookies(urls)) as CookieRecord[]
    const all = await launcher.exportCookies(p, store().settings)
    if (!urls || !urls.length) return all
    const hosts = urls.map((u) => { try { return new URL(u).hostname } catch { return u } })
    return all.filter((c) => hosts.some((h) => h === c.domain.replace(/^\./, '') || h.endsWith(c.domain)))
  }

  async cookiesSet(profileId: string, cookies: CookieRecord[]): Promise<{ added: number }> {
    const p = this.resolveProfile(profileId)
    if (!Array.isArray(cookies) || !cookies.length) throw new AutomationError('bad_input', 'cookies must be a non-empty array', 400)
    const n = await launcher.importCookies(p, store().settings, cookies)
    return { added: n }
  }

  async cookiesClear(profileId: string): Promise<{ ok: true }> {
    const p = this.resolveProfile(profileId)
    await launcher.clearCookies(p, store().settings)
    p.cookieCount = 0
    store().upsertProfile(p)
    return { ok: true }
  }

  // ---- raw CDP ----------------------------------------------------------
  // Through Playwright's own session on the pipe; one session per tab,
  // detached when the tab closes. Target.* and Browser.close are refused:
  // they would pull the rug from under Playwright and the running profile.

  async cdpSend(scope: { tabId?: string; profileId?: string }, method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!method || typeof method !== 'string') throw new AutomationError('bad_input', 'method is required', 400)
    if (CDP_DENY.some((re) => re.test(method))) throw new AutomationError('cdp_denied', `${method} is not allowed through the automation API`, 403)
    let session: CDPSession
    if (scope.tabId) {
      const t = this.tab(scope.tabId)
      if (!t.cdp) t.cdp = await this.requireContext(t.profileId).newCDPSession(t.page)
      session = t.cdp
    } else if (scope.profileId) {
      const p = this.resolveProfile(scope.profileId)
      const ctx = this.requireContext(p.id)
      let s = this.browserCdp.get(p.id)
      if (!s) {
        const browser = ctx.browser()
        if (!browser) throw new AutomationError('cdp_unavailable', 'Browser-level CDP session is not available for this context', 500)
        s = await browser.newBrowserCDPSession()
        this.browserCdp.set(p.id, s)
      }
      session = s
    } else throw new AutomationError('bad_input', 'Pass tabId (page session) or profileId (browser session)', 400)
    try {
      // Playwright types CDP methods strictly; the agent passes arbitrary ones.
      return await (session.send as unknown as (m: string, p?: Record<string, unknown>) => Promise<unknown>)(method, params)
    } catch (e) {
      throw new AutomationError('cdp_error', (e as Error).message, 400)
    }
  }

  // For the status line in Settings and the MCP server later.
  summary(): { profilesRunning: number; tabs: number } {
    return { profilesRunning: launcher.list().filter((r) => r.state === 'running').length, tabs: [...this.tabs.values()].filter((t) => !t.page.isClosed()).length }
  }
}

function clipText(text: string, maxChars: number): { text: string; truncated: boolean; length: number } {
  const length = text.length
  if (length <= maxChars) return { text, truncated: false, length }
  return { text: text.slice(0, maxChars), truncated: true, length }
}

export const automation = new AutomationService()
