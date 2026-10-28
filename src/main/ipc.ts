import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import fs from 'fs'
import type {
  AppInfo, Fingerprint, BatchCheckOptions, BatchItemEvent, CookieRecord, GenerateFingerprintOptions, Group, Profile,
  ProfileExport, ProxyCheckResult, ProxyConfig, SavedProxy, Settings
} from '@shared/types'
import { store, uid } from './store'
import { generateFingerprint, reseed } from './fingerprint/generator'
import { COUNTRY_LOCALES, PROFILE_COLORS } from './fingerprint/data'
import { launcher } from './browser/launcher'
import { engine } from './browser/engine'
import { checkProxy, pool } from './proxy/checker'
import { parseProxyLine, parseProxyList } from './proxy/parse'
import { cloud, CloudError } from './cloud/client'
import { sync } from './cloud/sync'
import { providers, providerMeta } from './providers'
import { updater } from './updater'
import { extensions } from './extensions'
import { FEATURED_EXTENSIONS } from '@shared/extensions'
import type { ProviderAccount, ProviderGenerateOptions } from '@shared/cloud'

function win(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] || null
}
function send(channel: string, payload: unknown): void {
  win()?.webContents.send(channel, payload)
}

function resolveProxy(profile: Profile): { config: ProxyConfig | null; info?: ProxyCheckResult } {
  const s = store()
  if (profile.proxy.mode === 'saved' && profile.proxy.savedId) {
    const p = s.getProxy(profile.proxy.savedId)
    if (!p) return { config: null }
    return { config: { protocol: p.protocol, host: p.host, port: p.port, username: p.username, password: p.password }, info: p.lastCheck }
  }
  if (profile.proxy.mode === 'custom' && profile.proxy.custom) return { config: profile.proxy.custom }
  return { config: null }
}

// The engine reports the host screen, so the profile records the real
// geometry; the Chromium version comes from the installed engine build.
function generateForHost(opts: GenerateFingerprintOptions): Fingerprint {
  const fp = generateFingerprint({ browserVersion: engine.status().installedVersion || undefined, ...opts })
  try {
    const d = screen.getPrimaryDisplay()
    fp.screen = { width: d.size.width, height: d.size.height, colorDepth: 24, pixelRatio: d.scaleFactor }
  } catch {
    /* keep generated */
  }
  return fp
}

export function newProfile(partial: Partial<Profile> = {}): Profile {
  const s = store()
  const now = Date.now()
  const idx = s.profiles.length
  return {
    id: uid('p'),
    name: `Profile ${idx + 1}`,
    notes: '',
    tags: [],
    color: PROFILE_COLORS[idx % PROFILE_COLORS.length],
    favorite: false,
    proxy: { mode: 'none' },
    fingerprint: generateForHost({}),
    startUrls: [],
    extensions: [],
    createdAt: now,
    updatedAt: now,
    launchCount: 0,
    ...partial
  }
}

function assertProfileCapacity(adding: number): void {
  const limit = sync.profileLimit()
  if (limit !== null && store().profiles.length + adding > limit) throw new Error('profile_limit')
}

export function registerIpc(): void {
  const s = store()
  s.on('local-change', () => sync.touch())
  sync.on('status', (st) => send('cloud:status', st))
  sync.on('data', () => send('cloud:data', null))

  // ---- app ---------------------------------------------------------------
  ipcMain.handle('app:info', (): AppInfo => {
    const e = engine.status()
    return { version: app.getVersion(), platform: process.platform, dataDir: app.getPath('userData'), engineInstalled: e.installed, engineVersion: e.installedVersion || '' }
  })
  ipcMain.handle('app:openPath', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('app:pickFile', async (_e, opts: { title?: string; filters?: Electron.FileFilter[]; directory?: boolean }) => {
    const r = await dialog.showOpenDialog(win()!, {
      title: opts.title,
      filters: opts.filters,
      properties: opts.directory ? ['openDirectory'] : ['openFile']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('app:saveText', async (_e, opts: { defaultPath: string; content: string; filters?: Electron.FileFilter[] }) => {
    const r = await dialog.showSaveDialog(win()!, { defaultPath: opts.defaultPath, filters: opts.filters })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, opts.content, 'utf8')
    return r.filePath
  })
  ipcMain.handle('app:readText', async (_e, opts: { filters?: Electron.FileFilter[] }) => {
    const r = await dialog.showOpenDialog(win()!, { filters: opts.filters, properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    return { path: r.filePaths[0], content: fs.readFileSync(r.filePaths[0], 'utf8') }
  })

  // ---- settings ---------------------------------------------------------
  ipcMain.handle('settings:get', () => s.settings)
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => s.setSettings(patch))

  // ---- groups -----------------------------------------------------------
  ipcMain.handle('groups:list', () => s.groups)
  ipcMain.handle('groups:save', (_e, g: Group) => s.upsertGroup({ ...g, id: g.id || uid('g') }))
  ipcMain.handle('groups:delete', (_e, id: string) => s.deleteGroup(id))

  // ---- profiles ---------------------------------------------------------
  ipcMain.handle('profiles:list', () => s.profiles)
  ipcMain.handle('profiles:new', (_e, partial?: Partial<Profile>) => newProfile(partial))
  ipcMain.handle('profiles:save', (_e, p: Profile) => {
    const prev = s.getProfile(p.id)
    if (!prev) assertProfileCapacity(1)
    // The editor works on a copy; keep main-process-only fields it never sees.
    if (prev && p.lastTabs === undefined) p.lastTabs = prev.lastTabs
    return s.upsertProfile(p)
  })
  ipcMain.handle('profiles:delete', async (_e, ids: string[], wipeData: boolean) => {
    for (const id of ids) {
      if (launcher.isRunning(id)) await launcher.stop(id)
      const p = s.getProfile(id)
      if (p && wipeData) await launcher.deleteProfileData(p, s.settings)
    }
    s.deleteProfiles(ids)
    return s.profiles
  })
  ipcMain.handle('profiles:clone', (_e, id: string, opts: { count: number; newFingerprint: boolean; copyData: boolean }) => {
    const src = s.getProfile(id)
    if (!src) throw new Error('Profile not found')
    assertProfileCapacity(Math.max(1, opts.count))
    const created: Profile[] = []
    for (let i = 0; i < Math.max(1, opts.count); i++) {
      const clone: Profile = {
        ...structuredClone(src),
        id: uid('p'),
        name: `${src.name} (copy${opts.count > 1 ? ' ' + (i + 1) : ''})`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        launchCount: 0,
        lastLaunchedAt: undefined,
        favorite: false,
        fingerprint: opts.newFingerprint ? generateForHost({ os: src.fingerprint.os, browserVersion: src.fingerprint.browserVersion }) : reseed(src.fingerprint)
      }
      if (opts.newFingerprint) {
        clone.fingerprint.timezone = src.fingerprint.timezone
        clone.fingerprint.geolocation = src.fingerprint.geolocation
        clone.fingerprint.locale = src.fingerprint.locale
        clone.fingerprint.languages = src.fingerprint.languages
      }
      if (opts.copyData) launcher.copyProfileData(src, clone, s.settings)
      s.upsertProfile(clone)
      created.push(clone)
    }
    return created
  })
  ipcMain.handle('profiles:export', async (_e, ids: string[]) => {
    const set = new Set(ids)
    const profiles = s.profiles.filter((p) => set.has(p.id))
    const proxyIds = new Set(profiles.map((p) => p.proxy.savedId).filter(Boolean))
    const payload: ProfileExport = {
      version: 1,
      exportedAt: Date.now(),
      profiles,
      proxies: s.proxies.filter((p) => proxyIds.has(p.id)),
      groups: s.groups
    }
    const r = await dialog.showSaveDialog(win()!, { defaultPath: `facetbrowser-profiles-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, JSON.stringify(payload, null, 2))
    return r.filePath
  })
  ipcMain.handle('profiles:import', async () => {
    const r = await dialog.showOpenDialog(win()!, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return 0
    const payload = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) as ProfileExport
    let n = 0
    for (const g of payload.groups || []) if (!s.groups.find((x) => x.id === g.id)) s.upsertGroup(g)
    for (const p of payload.proxies || []) if (!s.getProxy(p.id)) s.upsertProxy(p)
    for (const p of payload.profiles || []) {
      const existing = s.getProfile(p.id)
      if (!existing) { try { assertProfileCapacity(1) } catch { break } }
      s.upsertProfile(existing ? { ...p, id: uid('p'), name: `${p.name} (imported)` } : p)
      n++
    }
    return n
  })

  // ---- fingerprint ------------------------------------------------------
  ipcMain.handle('fingerprint:generate', (_e, opts: GenerateFingerprintOptions) => generateForHost(opts))
  ipcMain.handle('fingerprint:adaptToProxy', (_e, profile: Profile) => {
    const { info } = resolveProxy(profile)
    if (!info || !info.countryCode) throw new Error('Proxy has no check result yet. Run a proxy check first.')
    const loc = COUNTRY_LOCALES[info.countryCode]
    const fp = { ...profile.fingerprint }
    if (loc) {
      fp.locale = loc.locale
      fp.languages = loc.languages
    }
    if (info.timezone) fp.timezone = info.timezone
    if (typeof info.lat === 'number' && typeof info.lon === 'number') fp.geolocation = { mode: 'custom', lat: info.lat, lon: info.lon, accuracy: 1500 }
    return fp
  })

  // ---- browser ----------------------------------------------------------
  launcher.on('status', (list) => send('browser:status', list))
  // Remember the tabs a profile had when it closed, so the next launch reopens them.
  launcher.on('closed', (id: string, tabs?: string[]) => {
    if (!Array.isArray(tabs)) return
    const p = s.getProfile(id)
    if (!p || JSON.stringify(p.lastTabs || []) === JSON.stringify(tabs)) return
    p.lastTabs = tabs
    s.upsertProfile(p)
    send('cloud:data', null)
  })
  ipcMain.handle('browser:list', () => launcher.list())
  ipcMain.handle('browser:launch', async (_e, id: string) => {
    const p = s.getProfile(id)
    if (!p) throw new Error('Profile not found')
    const gate = sync.licenseGate()
    if (!gate.ok) throw new Error(gate.reason)
    await sync.pullCookiesIfNewer(id).catch(() => {})
    const { config, info } = resolveProxy(p)
    await launcher.launch({ profile: p, proxy: config, proxyInfo: info, settings: s.settings, extensionDirs: extensions.dirsFor(p) })
    p.launchCount = (p.launchCount || 0) + 1
    p.lastLaunchedAt = Date.now()
    s.upsertProfile(p)
    return p
  })
  ipcMain.handle('browser:stop', (_e, id: string) => launcher.stop(id))

  // ---- extensions ------------------------------------------------------
  ipcMain.handle('extensions:list', () => extensions.list())
  ipcMain.handle('extensions:featured', () => FEATURED_EXTENSIONS)
  ipcMain.handle('extensions:install', async (_e, input: string) => { await extensions.install(input); return extensions.list() })
  ipcMain.handle('extensions:remove', (_e, id: string) => { extensions.remove(id); return extensions.list() })
  ipcMain.handle('extensions:setAll', (_e, id: string, on: boolean) => extensions.setAll(id, on))
  ipcMain.handle('extensions:dataProfiles', (_e, id: string) => extensions.dataProfiles(id))
  ipcMain.handle('extensions:copyData', (_e, id: string, from: string, to: string[]) => extensions.copyData(id, from, to))

  // ---- updates ---------------------------------------------------------
  updater.on('status', (st) => send('update:status', st))
  ipcMain.handle('update:status', () => updater.status())
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.handle('update:download', () => updater.download())
  ipcMain.handle('update:install', () => updater.install())
  ipcMain.handle('browser:stopAll', () => launcher.stopAll())

  // ---- cookies ----------------------------------------------------------
  ipcMain.handle('cookies:export', async (_e, id: string) => {
    const p = s.getProfile(id)
    if (!p) throw new Error('Profile not found')
    return launcher.exportCookies(p, s.settings)
  })
  ipcMain.handle('cookies:import', async (_e, id: string, text: string) => {
    const p = s.getProfile(id)
    if (!p) throw new Error('Profile not found')
    const cookies = parseCookieText(text)
    const n = await launcher.importCookies(p, s.settings, cookies)
    p.cookieCount = await launcher.countCookies(p, s.settings).catch(() => n)
    s.upsertProfile(p)
    return n
  })
  ipcMain.handle('cookies:clear', async (_e, id: string) => {
    const p = s.getProfile(id)
    if (!p) throw new Error('Profile not found')
    await launcher.clearCookies(p, s.settings)
    p.cookieCount = 0
    s.upsertProfile(p)
  })

  // ---- proxies ----------------------------------------------------------
  ipcMain.handle('proxies:list', () => s.proxies)
  ipcMain.handle('proxies:save', (_e, p: SavedProxy) => s.upsertProxy({ ...p, id: p.id || uid('x') }))
  ipcMain.handle('proxies:delete', (_e, ids: string[]) => { s.deleteProxies(ids); return s.proxies })
  ipcMain.handle('proxies:importText', (_e, text: string, tags: string[]) => {
    const now = Date.now()
    let n = 0
    for (const { parsed } of parseProxyList(text)) {
      if (!parsed) continue
      const dup = s.proxies.find((p) => p.host === parsed.host && p.port === parsed.port && p.username === parsed.username && p.protocol === parsed.protocol)
      if (dup) continue
      s.upsertProxy({ ...parsed, id: uid('x'), name: '', tags: tags || [], createdAt: now, updatedAt: now })
      n++
    }
    return { added: n, proxies: s.proxies }
  })
  ipcMain.handle('proxies:parse', (_e, line: string) => parseProxyLine(line))
  ipcMain.handle('proxies:check', async (_e, ids: string[], opts?: { speedTest?: boolean }) => {
    const targets = ids.map((id) => s.getProxy(id)).filter(Boolean) as SavedProxy[]
    await pool(targets, s.settings.proxyCheckConcurrency || 5, async (p) => {
      send('proxies:checking', { id: p.id, stage: 'connecting' })
      const result = await checkProxy(p, {
        contact: s.settings.getipintelContact,
        abuseKey: s.settings.abuseIpDbKey,
        speedTest: opts?.speedTest ?? true,
        speedTestBytes: s.settings.speedTestBytes,
        onStage: (stage) => send('proxies:checking', { id: p.id, stage })
      })
      const fresh = s.getProxy(p.id)
      if (fresh) {
        fresh.lastCheck = result
        s.upsertProxy(fresh)
      }
      send('proxies:checked', { id: p.id, result })
    })
    return s.proxies
  })
  ipcMain.handle('proxies:checkConfig', (_e, cfg: ProxyConfig) =>
    checkProxy(cfg, { contact: s.settings.getipintelContact, abuseKey: s.settings.abuseIpDbKey, speedTest: true, speedTestBytes: s.settings.speedTestBytes })
  )

  // ---- engine -----------------------------------------------------------
  engine.on('status', (st) => send('engine:status', st))
  ipcMain.handle('engine:status', () => engine.status())
  ipcMain.handle('engine:install', () => engine.install())
  ipcMain.handle('engine:remove', () => { engine.remove(); return engine.status() })

  // ---- cloud account ----------------------------------------------------
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof CloudError) throw new Error(e.code)
      throw e
    }
  }
  ipcMain.handle('cloud:status', () => sync.status())
  ipcMain.handle('cloud:login', (_e, email: string, password: string) => wrap(async () => { await cloud.login(email, password); sync.start(); return sync.status() }))
  ipcMain.handle('cloud:register', (_e, email: string, password: string) => wrap(async () => { await cloud.register(email, password); sync.start(); return sync.status() }))
  ipcMain.handle('cloud:logout', async () => { sync.stop(); await cloud.logout(); return sync.status() })
  ipcMain.handle('cloud:me', () => wrap(async () => { await cloud.me(); return sync.status() }))
  ipcMain.handle('cloud:resendVerification', () => wrap(() => cloud.resendVerification()))
  ipcMain.handle('cloud:forgot', (_e, email: string) => wrap(() => cloud.forgot(email)))
  ipcMain.handle('cloud:syncNow', async () => { await sync.run(); return sync.status() })
  ipcMain.handle('cloud:gate', () => sync.licenseGate())

  // ---- proxy providers --------------------------------------------------
  let providerCache: ProviderAccount[] = []
  const loadAccounts = async (): Promise<ProviderAccount[]> => {
    providerCache = await wrap(() => cloud.providerAccounts())
    return providerCache
  }
  const accountById = async (id: string): Promise<ProviderAccount> => {
    const acc = providerCache.find((a) => a.id === id) || (await loadAccounts()).find((a) => a.id === id)
    if (!acc) throw new Error('Provider account not found')
    return acc
  }
  ipcMain.handle('providers:meta', () => providerMeta())
  ipcMain.handle('providers:accounts', () => loadAccounts())
  ipcMain.handle('providers:save', async (_e, acc: Omit<ProviderAccount, 'createdAt' | 'updatedAt'>) => { await wrap(() => cloud.providerAccountSave(acc)); return loadAccounts() })
  ipcMain.handle('providers:delete', async (_e, id: string) => { await wrap(() => cloud.providerAccountDelete(id)); return loadAccounts() })
  ipcMain.handle('providers:balance', async (_e, id: string) => { const acc = await accountById(id); return providers[acc.provider].balance(acc) })
  ipcMain.handle('providers:countries', async (_e, id: string) => { const acc = await accountById(id); return providers[acc.provider].countries(acc) })
  ipcMain.handle('providers:generate', async (_e, id: string, opts: ProviderGenerateOptions, save: boolean) => {
    const acc = await accountById(id)
    const configs = await providers[acc.provider].generate(acc, opts)
    if (!save) return { configs, saved: [] as SavedProxy[] }
    const now = Date.now()
    const saved: SavedProxy[] = []
    for (const c of configs) {
      const p = s.upsertProxy({ ...c, id: uid('x'), name: `${providers[acc.provider].name}${opts.country ? ' ' + opts.country.toUpperCase() : ''}`, tags: [acc.provider, ...(opts.country ? [opts.country.toUpperCase()] : [])], createdAt: now, updatedAt: now })
      saved.push(p)
    }
    return { configs, saved }
  })

  // ---- batch checker (proxy-checker port) ------------------------------
  let batchAbort = false
  ipcMain.handle('checker:run', async (_e, lines: string[], opts: BatchCheckOptions) => {
    batchAbort = false
    const items = lines.map((raw) => ({ raw, parsed: parseProxyLine(raw) }))
    const emit = (ev: BatchItemEvent): void => send('checker:event', ev)
    items.forEach((it, index) => emit({ index, raw: it.raw, stage: 'queued' }))
    const results = await pool(items, Math.max(1, opts.concurrency || 5), async (it, index) => {
      if (batchAbort) return null
      if (!it.parsed) {
        const result: ProxyCheckResult = { checkedAt: Date.now(), ok: false, error: 'Invalid format', quality: 0, grade: 'F', verdict: 'Invalid', issues: ['Invalid format'] }
        emit({ index, raw: it.raw, stage: 'failed', result })
        return result
      }
      emit({ index, raw: it.raw, stage: 'connecting' })
      const result = await checkProxy(it.parsed, {
        contact: opts.contact,
        abuseKey: opts.abuseKey,
        skipReportedForIntel: opts.skipReported,
        speedTest: opts.speedTest,
        speedTestBytes: s.settings.speedTestBytes,
        onStage: (stage) => emit({ index, raw: it.raw, stage })
      })
      emit({ index, raw: it.raw, stage: result.ok ? 'done' : 'failed', result })
      return result
    })
    return results
  })
  ipcMain.handle('checker:abort', () => { batchAbort = true })
}

// Accepts Playwright/Puppeteer JSON arrays, EditThisCookie exports, or Netscape cookies.txt.
export function parseCookieText(text: string): CookieRecord[] {
  const t = text.trim()
  if (t.startsWith('[') || t.startsWith('{')) {
    const json = JSON.parse(t)
    const arr = Array.isArray(json) ? json : Array.isArray(json.cookies) ? json.cookies : []
    return arr.map((c: Record<string, unknown>) => ({
      name: String(c.name ?? ''),
      value: String(c.value ?? ''),
      domain: String(c.domain ?? ''),
      path: String(c.path ?? '/'),
      expires: typeof c.expires === 'number' ? c.expires : typeof c.expirationDate === 'number' ? c.expirationDate : -1,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite: normaliseSameSite(c.sameSite)
    }))
  }
  const out: CookieRecord[] = []
  for (const line of t.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const parts = line.split('\t')
    if (parts.length < 7) continue
    out.push({
      domain: parts[0],
      path: parts[2],
      secure: parts[3].toUpperCase() === 'TRUE',
      expires: parseInt(parts[4], 10) || -1,
      name: parts[5],
      value: parts[6],
      httpOnly: parts[0].startsWith('#HttpOnly_'),
      sameSite: 'Lax'
    })
  }
  return out
}

function normaliseSameSite(v: unknown): 'Strict' | 'Lax' | 'None' {
  const s = String(v ?? '').toLowerCase()
  if (s === 'strict') return 'Strict'
  if (s === 'none' || s === 'no_restriction') return 'None'
  return 'Lax'
}
