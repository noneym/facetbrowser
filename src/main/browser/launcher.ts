import { chromium, type BrowserContext, type Page } from 'playwright-core'
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import type { CookieRecord, Profile, ProxyConfig, ProxyCheckResult, RunningProfile, SessionJar, Settings, StorageOrigin } from '@shared/types'
import { buildFingerprintScript } from './fingerprint-script'
import { startBridge, type Bridge } from '../proxy/bridge'
import { engine } from './engine'

interface Running {
  context: BrowserContext
  bridge: Bridge | null
  startedAt: number
  state: RunningProfile['state']
  origins: Set<string> // http(s) origins navigated to in this run
  tabs: Map<Page, string> // current URL per open tab
  tabSnapshot: string[] // last known tab list, kept across the shutdown burst of page closes
  tabTimer: NodeJS.Timeout | null
}

const MAX_TABS = 50

// Limits for the localStorage part of the account jar (server cap is 8 MB).
const STORAGE_ITEM_MAX = 256 * 1024
const STORAGE_ORIGIN_MAX = 1024 * 1024
const STORAGE_TOTAL_MAX = 6 * 1024 * 1024

function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

export interface LaunchInput {
  profile: Profile
  proxy: ProxyConfig | null
  proxyInfo?: ProxyCheckResult
  settings: Settings
}

// Chrome derives Accept-Language and navigator.languages from this pref.
// exit_type is deliberately 'Crashed': Chromium only keeps session cookies
// (the kind most logins use) across a restart when it believes the previous
// run did not end cleanly. With a 'Normal' exit it purges them at the next
// start, which logged the user out of every site. The crash bubble is hidden
// with --hide-crash-restore-bubble and tabs are not restored, so the only
// visible effect is that logins survive.
function writeProfilePrefs(userDataDir: string, languages: string[]): void {
  const dir = path.join(userDataDir, 'Default')
  const file = path.join(dir, 'Preferences')
  fs.mkdirSync(dir, { recursive: true })
  let prefs: Record<string, unknown> = {}
  try {
    if (fs.existsSync(file)) prefs = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    prefs = {}
  }
  const intl = (prefs.intl as Record<string, unknown>) || {}
  intl.accept_languages = languages.join(',')
  intl.selected_languages = languages.join(',')
  prefs.intl = intl
  const profile = (prefs.profile as Record<string, unknown>) || {}
  profile.exit_type = 'Crashed'
  profile.exited_cleanly = false
  prefs.profile = profile
  const bar = (prefs.bookmark_bar as Record<string, unknown>) || {}
  if (bar.show_on_all_tabs === undefined) bar.show_on_all_tabs = false
  prefs.bookmark_bar = bar
  fs.writeFileSync(file, JSON.stringify(prefs), 'utf8')
}

// fingerprint-chromium flags. The seed derives canvas, WebGL, audio and font
// noise plus GPU as one coherent identity; the rest comes from the profile.
export function engineArgs(profile: Profile, timezoneId?: string): string[] {
  const fp = profile.fingerprint
  const platform = fp.os === 'macos' ? 'macos' : fp.os === 'linux' ? 'linux' : 'windows'
  const args = [
    `--fingerprint=${fp.seed % 2147483647}`,
    `--fingerprint-platform=${platform}`,
    '--fingerprint-brand=Chrome',
    `--fingerprint-hardware-concurrency=${fp.hardwareConcurrency}`,
    `--accept-lang=${(fp.languages.length ? fp.languages : [fp.locale]).join(',')}`,
    `--lang=${fp.locale}`
  ]
  if (timezoneId) args.push(`--timezone=${timezoneId}`)
  const off = [fp.canvas === 'real' && 'canvas', fp.webgl.mode === 'real' && 'gpu', fp.audio === 'real' && 'audio', fp.clientRects === 'real' && 'clientrects', fp.fonts === 'real' && 'font'].filter(Boolean)
  if (off.length) args.push(`--disable-spoofing=${off.join(',')}`)
  return args
}

class Launcher extends EventEmitter {
  private running = new Map<string, Running>()

  list(): RunningProfile[] {
    return [...this.running.entries()].map(([profileId, r]) => ({
      profileId,
      state: r.state,
      startedAt: r.startedAt,
      bridgePort: r.bridge?.port,
      pages: r.state === 'running' ? safePages(r.context) : 0
    }))
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  contextOf(id: string): BrowserContext | undefined {
    const r = this.running.get(id)
    return r && r.state === 'running' ? r.context : undefined
  }

  originsOf(id: string): string[] {
    return [...(this.running.get(id)?.origins || [])]
  }

  tabsOf(id: string): string[] {
    return [...(this.running.get(id)?.tabSnapshot || [])]
  }

  private emitStatus(): void {
    this.emit('status', this.list())
  }

  userDataDir(profile: Profile, settings: Settings): string {
    return path.join(settings.profilesDir, profile.id)
  }

  async launch(input: LaunchInput): Promise<void> {
    const { profile, proxy, proxyInfo, settings } = input
    if (this.running.has(profile.id)) throw new Error('Profile is already running')

    const exe = engine.exePath()
    if (!exe) throw new Error('engine_not_installed')

    const dir = this.userDataDir(profile, settings)
    fs.mkdirSync(dir, { recursive: true })

    let bridge: Bridge | null = null
    if (proxy) bridge = await startBridge(proxy)

    const placeholder: Running = { context: null as unknown as BrowserContext, bridge, startedAt: Date.now(), state: 'starting', origins: new Set(), tabs: new Map(), tabSnapshot: [], tabTimer: null }
    this.running.set(profile.id, placeholder)
    this.emitStatus()

    try {
      const fp = profile.fingerprint
      const timezoneId = fp.timezone === 'auto' ? proxyInfo?.timezone || undefined : fp.timezone
      let geolocation: { latitude: number; longitude: number; accuracy?: number } | undefined
      if (fp.geolocation.mode === 'custom' && typeof fp.geolocation.lat === 'number' && typeof fp.geolocation.lon === 'number') {
        geolocation = { latitude: fp.geolocation.lat, longitude: fp.geolocation.lon, accuracy: fp.geolocation.accuracy ?? 100 }
      } else if (fp.geolocation.mode === 'auto' && typeof proxyInfo?.lat === 'number' && typeof proxyInfo?.lon === 'number') {
        geolocation = { latitude: proxyInfo.lat, longitude: proxyInfo.lon, accuracy: 1500 }
      }

      writeProfilePrefs(dir, fp.languages.length ? fp.languages : [fp.locale])

      // Playwright's default switch list is bypassed; only the debugging pipe
      // and the engine flags are passed, so nothing looks automated.
      const args = [
        `--user-data-dir=${dir}`,
        '--remote-debugging-pipe',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-search-engine-choice-screen',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        `--window-size=${Math.min(fp.screen.width, 1600)},${Math.min(fp.screen.height, 1000)}`,
        ...engineArgs(profile, timezoneId)
      ]
      if (bridge) {
        args.push(`--proxy-server=http://127.0.0.1:${bridge.port}`)
        args.push('--proxy-bypass-list=<-loopback>')
      }
      if (fp.webrtc === 'real') args.push('--force-webrtc-ip-handling-policy=default')
      const extensions = profile.extensions.filter((e) => e && fs.existsSync(e))
      if (extensions.length) {
        args.push(`--disable-extensions-except=${extensions.join(',')}`)
        args.push(`--load-extension=${extensions.join(',')}`)
      }
      args.push('about:blank')

      const context = await chromium.launchPersistentContext(dir, {
        executablePath: exe,
        headless: false,
        chromiumSandbox: true,
        viewport: null,
        timezoneId,
        geolocation,
        permissions: geolocation ? ['geolocation'] : [],
        ignoreDefaultArgs: true,
        args,
        ignoreHTTPSErrors: false,
        bypassCSP: false,
        serviceWorkers: 'allow'
      })

      await context.addInitScript(buildFingerprintScript(fp, { publicIp: proxyInfo?.ip }))

      const entry: Running = { context, bridge, startedAt: Date.now(), state: 'running', origins: new Set(), tabs: new Map(), tabSnapshot: [], tabTimer: null }
      this.running.set(profile.id, entry)
      context.on('close', () => this.cleanup(profile.id))
      // Tab tracking for "reopen where I left off". A tab that closes is
      // dropped from the snapshot only after a short delay: when the browser
      // shuts down every tab closes at once, and that burst must not wipe the
      // list we are about to save.
      const snapshot = (): void => {
        entry.tabSnapshot = [...entry.tabs.values()].filter((u) => originOf(u)).slice(0, MAX_TABS)
      }
      const track = (page: Page): void => {
        const url = page.url()
        if (url) entry.tabs.set(page, url)
        page.on('framenavigated', (f) => {
          if (f.parentFrame()) return
          entry.tabs.set(page, f.url())
          const o = originOf(f.url())
          if (o) entry.origins.add(o)
          snapshot()
        })
        page.on('close', () => {
          entry.tabs.delete(page)
          if (entry.tabTimer) clearTimeout(entry.tabTimer)
          entry.tabTimer = setTimeout(() => {
            entry.tabTimer = null
            if (this.running.get(profile.id) === entry) snapshot()
          }, 1500)
        })
      }
      context.pages().forEach(track)
      context.on('page', track)

      if (!context.pages().length) await context.waitForEvent('page', { timeout: 5000 }).catch(() => null)

      // Where we left off beats the start page, when the setting allows it.
      const previous = settings.restoreTabs !== false ? (profile.lastTabs || []).filter((u) => originOf(u)) : []
      const urls = previous.length ? previous.slice(0, MAX_TABS) : profile.startUrls.filter(Boolean)
      if (!urls.length && settings.defaultStartUrl) urls.push(settings.defaultStartUrl)
      const pages = context.pages()
      for (let i = 0; i < urls.length; i++) {
        const page = i === 0 && pages[0] ? pages[0] : await context.newPage()
        page.goto(urls[i]).catch(() => {})
      }
      this.emitStatus()
    } catch (e) {
      await bridge?.close()
      this.running.delete(profile.id)
      this.emitStatus()
      throw e
    }
  }

  private async cleanup(profileId: string): Promise<void> {
    const r = this.running.get(profileId)
    if (!r) return
    this.running.delete(profileId)
    if (r.tabTimer) clearTimeout(r.tabTimer)
    await r.bridge?.close().catch(() => {})
    this.emit('closed', profileId, r.tabSnapshot)
    this.emitStatus()
  }

  async stop(profileId: string): Promise<void> {
    const r = this.running.get(profileId)
    if (!r) return
    r.state = 'stopping'
    this.emitStatus()
    // Give listeners (cookie upload) a chance to read the live context first.
    await Promise.all(this.listeners('beforeStop').map((l) => Promise.resolve((l as (id: string) => Promise<void>)(profileId)).catch(() => {})))
    try {
      await r.context?.close()
    } catch {
      /* ignore */
    }
    await this.cleanup(profileId)
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)))
  }

  // ---- cookies ---------------------------------------------------------
  // While a profile runs we talk to the live context. Otherwise the profile
  // directory is opened in a short-lived headless engine context.
  private async withContext<T>(profile: Profile, settings: Settings, fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
    const live = this.running.get(profile.id)
    if (live && (live.state === 'running' || live.state === 'stopping') && live.context) return fn(live.context)
    const exe = engine.exePath()
    if (!exe) throw new Error('engine_not_installed')
    const dir = this.userDataDir(profile, settings)
    fs.mkdirSync(dir, { recursive: true })
    // Same prefs as a real launch, so session cookies survive this open too.
    writeProfilePrefs(dir, profile.fingerprint.languages.length ? profile.fingerprint.languages : [profile.fingerprint.locale])
    const ctx = await chromium.launchPersistentContext(dir, {
      executablePath: exe,
      headless: true,
      chromiumSandbox: true,
      args: ['--no-first-run', '--no-default-browser-check', ...engineArgs(profile)],
      ignoreDefaultArgs: ['--enable-automation'],
      serviceWorkers: 'block'
    })
    try {
      return await fn(ctx)
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  async exportCookies(profile: Profile, settings: Settings): Promise<CookieRecord[]> {
    return this.withContext(profile, settings, async (ctx) => (await ctx.cookies()) as CookieRecord[])
  }

  async importCookies(profile: Profile, settings: Settings, cookies: CookieRecord[]): Promise<number> {
    return this.withContext(profile, settings, async (ctx) => {
      const clean = cookies
        .filter((c) => c.name && c.domain)
        .map((c) => ({
          name: c.name,
          value: String(c.value ?? ''),
          domain: c.domain,
          path: c.path || '/',
          expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : -1,
          httpOnly: !!c.httpOnly,
          secure: !!c.secure,
          sameSite: (['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax') as 'Strict' | 'Lax' | 'None'
        }))
      await ctx.addCookies(clean)
      return clean.length
    })
  }

  // ---- full session (cookies + localStorage) for the account jar ---------
  // localStorage is read and written over CDP's DOMStorage domain, which works
  // for any origin in the profile without opening a tab for it.
  async exportSession(profile: Profile, settings: Settings, knownOrigins: string[]): Promise<SessionJar> {
    const r = this.running.get(profile.id)
    const live = !!r && (r.state === 'running' || r.state === 'stopping') && !!r.context
    return this.withContext(profile, settings, async (ctx) => {
      const cookies = (await ctx.cookies()) as CookieRecord[]
      const origins = new Set<string>([...knownOrigins, ...this.originsOf(profile.id)])
      for (const p of safePageList(ctx)) {
        const o = originOf(p.url())
        if (o) origins.add(o)
      }
      const storage = await readStorage(ctx, [...origins], live).catch(() => [] as StorageOrigin[])
      return { cookies, storage }
    })
  }

  async importSession(profile: Profile, settings: Settings, jar: SessionJar): Promise<{ cookies: number; origins: number }> {
    const cookies = await this.importCookies(profile, settings, jar.cookies)
    let origins = 0
    if (jar.storage?.length) {
      origins = await this.withContext(profile, settings, (ctx) => writeStorage(ctx, jar.storage)).catch(() => 0)
    }
    return { cookies, origins }
  }

  async clearCookies(profile: Profile, settings: Settings): Promise<void> {
    await this.withContext(profile, settings, async (ctx) => ctx.clearCookies())
  }

  async countCookies(profile: Profile, settings: Settings): Promise<number> {
    return this.withContext(profile, settings, async (ctx) => (await ctx.cookies()).length)
  }

  // Chromium keeps a few files locked for a moment after the window closes;
  // retry instead of failing the delete on Windows.
  async deleteProfileData(profile: Profile, settings: Settings): Promise<void> {
    const dir = this.userDataDir(profile, settings)
    if (!fs.existsSync(dir)) return
    let lastErr: unknown = null
    for (let i = 0; i < 12; i++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
        return
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    throw lastErr
  }

  copyProfileData(src: Profile, dst: Profile, settings: Settings): void {
    const from = this.userDataDir(src, settings)
    const to = this.userDataDir(dst, settings)
    if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true, filter: (p) => !/(Singleton|lockfile|\.lock$|Crashpad|GPUCache|Code Cache)/i.test(p) })
  }
}

function safePageList(ctx: BrowserContext): Page[] {
  try {
    return ctx.pages()
  } catch {
    return []
  }
}

// localStorage per origin. Chromium has no API to read another origin's
// storage without a frame on it, so (like Playwright's storageState) a hidden
// page is pointed at the origin with every request answered locally; nothing
// touches the network. Only used on headless contexts (never flashes a tab).
async function withOriginPage<T>(ctx: BrowserContext, origin: string, fn: (page: Page) => Promise<T>): Promise<T | null> {
  const page = await ctx.newPage()
  try {
    await page.route('**/*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' }))
    await page.goto(origin + '/', { waitUntil: 'commit', timeout: 8000 })
    return await fn(page)
  } catch {
    return null
  } finally {
    await page.close().catch(() => {})
  }
}

function clip(entries: Array<[string, string]>): Record<string, string> | null {
  const items: Record<string, string> = {}
  let size = 0
  for (const [k, v] of entries) {
    const len = k.length + String(v).length
    if (len > STORAGE_ITEM_MAX || size + len > STORAGE_ORIGIN_MAX) continue
    items[k] = String(v)
    size += len
  }
  return Object.keys(items).length ? items : null
}

const READ_LS = (): Array<[string, string]> => Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) || ''])

// live: read from the tabs that are open (no navigation). headless: visit
// every known origin on a hidden page.
async function readStorage(ctx: BrowserContext, origins: string[], live: boolean): Promise<StorageOrigin[]> {
  const out: StorageOrigin[] = []
  let total = 0
  const push = (origin: string, entries: Array<[string, string]> | null): boolean => {
    if (!entries) return true
    const items = clip(entries)
    if (!items) return true
    const size = JSON.stringify(items).length
    if (total + size > STORAGE_TOTAL_MAX) return false
    total += size
    out.push({ origin, items })
    return true
  }
  if (live) {
    const seen = new Set<string>()
    for (const page of safePageList(ctx)) {
      const origin = originOf(page.url())
      if (!origin || seen.has(origin)) continue
      seen.add(origin)
      const entries = await page.evaluate(READ_LS).catch(() => null)
      if (!push(origin, entries)) break
    }
    return out
  }
  for (const origin of origins) {
    const entries = await withOriginPage(ctx, origin, (p) => p.evaluate(READ_LS))
    if (!push(origin, entries)) break
  }
  return out
}

async function writeStorage(ctx: BrowserContext, storage: StorageOrigin[]): Promise<number> {
  let n = 0
  for (const { origin, items } of storage) {
    if (!originOf(origin) || !items || typeof items !== 'object') continue
    const ok = await withOriginPage(ctx, origin, (p) =>
      p.evaluate((entries) => {
        for (const [k, v] of entries) localStorage.setItem(k, v)
        return true
      }, Object.entries(items).map(([k, v]) => [k, String(v)]))
    )
    if (ok) n++
  }
  return n
}

function safePages(ctx: BrowserContext): number {
  try {
    return ctx.pages().length
  } catch {
    return 0
  }
}

export const launcher = new Launcher()
