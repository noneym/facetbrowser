import { chromium, type BrowserContext } from 'playwright-core'
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import type { CookieRecord, OsFamily, Profile, ProxyConfig, ProxyCheckResult, RunningProfile, Settings } from '@shared/types'
import { buildFingerprintScript } from './fingerprint-script'
import { startBridge, type Bridge } from '../proxy/bridge'
import { detectBrowser } from './chrome-detect'
import { engine } from './engine'

interface Running {
  context: BrowserContext
  bridge: Bridge | null
  startedAt: number
  state: RunningProfile['state']
}

export interface LaunchInput {
  profile: Profile
  proxy: ProxyConfig | null
  proxyInfo?: ProxyCheckResult
  settings: Settings
}

export function hostOs(): OsFamily {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
}

// Chrome derives Accept-Language and navigator.languages from this pref, so
// setting it in the profile is the only way to change the language without a
// CDP user-agent override (which would also replace client hints).
function writeLanguagePrefs(userDataDir: string, languages: string[]): void {
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
  // Skip the "restore pages?" bubble after a non-clean exit.
  const profile = (prefs.profile as Record<string, unknown>) || {}
  profile.exit_type = 'Normal'
  profile.exited_cleanly = true
  prefs.profile = profile
  const bar = (prefs.bookmark_bar as Record<string, unknown>) || {}
  if (bar.show_on_all_tabs === undefined) bar.show_on_all_tabs = false
  prefs.bookmark_bar = bar
  fs.writeFileSync(file, JSON.stringify(prefs), 'utf8')
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

  private emitStatus(): void {
    this.emit('status', this.list())
  }

  userDataDir(profile: Profile, settings: Settings): string {
    return path.join(settings.profilesDir, profile.id)
  }

  async launch(input: LaunchInput): Promise<void> {
    const { profile, proxy, proxyInfo, settings } = input
    if (this.running.has(profile.id)) throw new Error('Profile is already running')

    const useEngine = settings.engine === 'facet'
    const engineExe = useEngine ? engine.exePath() : null
    if (useEngine && !engineExe) throw new Error('engine_not_installed')
    const browser = useEngine ? { found: true, path: engineExe as string, version: engine.status().installedVersion || '', channel: 'custom' as const } : detectBrowser(settings)
    if (!browser.found) throw new Error('No Chromium-based browser found. Set a browser path in Settings.')

    const dir = this.userDataDir(profile, settings)
    fs.mkdirSync(dir, { recursive: true })

    let bridge: Bridge | null = null
    if (proxy) bridge = await startBridge(proxy)

    const placeholder: Running = { context: null as unknown as BrowserContext, bridge, startedAt: Date.now(), state: 'starting' }
    this.running.set(profile.id, placeholder)
    this.emitStatus()

    try {
      const fp = profile.fingerprint
      const major = (browser.version || fp.browserVersion).split('.')[0]
      // When the profile OS equals the host OS we let Chrome send its own UA
      // and client hints untouched; everything stays consistent at the
      // network level. Cross-OS profiles need a CDP override of the UA.
      // On the engine the UA is produced in C++ from --fingerprint-platform/-brand.
      const nativeUa = useEngine || fp.os === hostOs()
      const userAgent = nativeUa ? undefined : fp.userAgent.replace(/Chrome\/\d+(\.\d+)*/, `Chrome/${major}.0.0.0`)

      const timezoneId = fp.timezone === 'auto' ? proxyInfo?.timezone || undefined : fp.timezone
      let geolocation: { latitude: number; longitude: number; accuracy?: number } | undefined
      if (fp.geolocation.mode === 'custom' && typeof fp.geolocation.lat === 'number' && typeof fp.geolocation.lon === 'number') {
        geolocation = { latitude: fp.geolocation.lat, longitude: fp.geolocation.lon, accuracy: fp.geolocation.accuracy ?? 100 }
      } else if (fp.geolocation.mode === 'auto' && typeof proxyInfo?.lat === 'number' && typeof proxyInfo?.lon === 'number') {
        geolocation = { latitude: proxyInfo.lat, longitude: proxyInfo.lon, accuracy: 1500 }
      }

      writeLanguagePrefs(dir, fp.languages.length ? fp.languages : [fp.locale])

      // We bypass Playwright's default switch list entirely: it disables
      // dozens of features (client hint frames, HTTPS upgrades, translate,
      // background networking...) and adds --no-sandbox, all of which make
      // the browser look automated. Only the two switches Playwright needs
      // to talk to the process are kept. No flag from Chrome's "bad flags"
      // list is used, so no warning bar appears.
      const args = [
        `--user-data-dir=${dir}`,
        '--remote-debugging-pipe',
        // Clears navigator.webdriver (Chrome sets it for any remote debugging
        // session). --test-type suppresses the "unsupported command-line flag"
        // bar that this switch would otherwise trigger.
        '--disable-blink-features=AutomationControlled',
        '--test-type',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-search-engine-choice-screen',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        `--lang=${fp.locale}`,
        `--window-size=${Math.min(fp.screen.width, 1600)},${Math.min(fp.screen.height, 1000)}`
      ]
      if (bridge) {
        args.push(`--proxy-server=http://127.0.0.1:${bridge.port}`)
        args.push('--proxy-bypass-list=<-loopback>')
        if (fp.webrtc !== 'real') args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp')
      }
      const extensions = profile.extensions.filter((e) => e && fs.existsSync(e))
      if (extensions.length) {
        args.push(`--disable-extensions-except=${extensions.join(',')}`)
        args.push(`--load-extension=${extensions.join(',')}`)
      }
      if (useEngine) {
        // fingerprint-chromium flags: the seed derives canvas/WebGL/audio/font
        // noise plus GPU, cores and memory as one coherent identity.
        const platform = fp.os === 'macos' ? 'macos' : fp.os === 'linux' ? 'linux' : 'windows'
        args.push(`--fingerprint=${fp.seed % 2147483647}`)
        args.push(`--fingerprint-platform=${platform}`)
        args.push('--fingerprint-brand=Chrome')
        args.push(`--fingerprint-hardware-concurrency=${fp.hardwareConcurrency}`)
        if (timezoneId) args.push(`--timezone=${timezoneId}`)
        args.push(`--accept-lang=${(fp.languages.length ? fp.languages : [fp.locale]).join(',')}`)
        if (fp.canvas === 'real' || fp.webgl.mode === 'real' || fp.audio === 'real' || fp.clientRects === 'real' || fp.fonts === 'real') {
          const off = [fp.canvas === 'real' && 'canvas', fp.webgl.mode === 'real' && 'gpu', fp.audio === 'real' && 'audio', fp.clientRects === 'real' && 'clientrects', fp.fonts === 'real' && 'font'].filter(Boolean)
          args.push(`--disable-spoofing=${off.join(',')}`)
        }
      }
      args.push('about:blank')

      const context = await chromium.launchPersistentContext(dir, {
        executablePath: browser.path,
        headless: false,
        chromiumSandbox: true,
        viewport: null,
        userAgent,
        timezoneId,
        geolocation,
        permissions: geolocation ? ['geolocation'] : [],
        ignoreDefaultArgs: true,
        args,
        ignoreHTTPSErrors: false,
        bypassCSP: false,
        serviceWorkers: 'allow'
      })

      await context.addInitScript(buildFingerprintScript(fp, { publicIp: proxyInfo?.ip, uaOverride: !nativeUa, engineMode: useEngine }))

      const entry: Running = { context, bridge, startedAt: Date.now(), state: 'running' }
      this.running.set(profile.id, entry)
      context.on('close', () => this.cleanup(profile.id))

      // With default args ignored, Playwright does not wait for the initial
      // about:blank tab, so give it a moment to show up.
      if (!context.pages().length) await context.waitForEvent('page', { timeout: 5000 }).catch(() => null)

      const urls = profile.startUrls.filter(Boolean)
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
    await r.bridge?.close().catch(() => {})
    this.emit('closed', profileId)
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
  // directory is opened in a short-lived headless context.
  private async withContext<T>(profile: Profile, settings: Settings, fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
    const live = this.running.get(profile.id)
    if (live && live.state === 'running') return fn(live.context)
    const engineExe = settings.engine === 'facet' ? engine.exePath() : null
    const browser = engineExe ? { found: true, path: engineExe } : detectBrowser(settings)
    if (!browser.found) throw new Error('No browser found')
    const dir = this.userDataDir(profile, settings)
    fs.mkdirSync(dir, { recursive: true })
    const ctx = await chromium.launchPersistentContext(dir, {
      executablePath: browser.path,
      headless: true,
      chromiumSandbox: true,
      args: ['--no-first-run', '--no-default-browser-check'],
      ignoreDefaultArgs: ['--enable-automation']
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

function safePages(ctx: BrowserContext): number {
  try {
    return ctx.pages().length
  } catch {
    return 0
  }
}

export const launcher = new Launcher()
