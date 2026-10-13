import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Group, Profile, SavedProxy, Settings } from '@shared/types'

interface Data {
  profiles: Profile[]
  proxies: SavedProxy[]
  groups: Group[]
  settings: Settings
}

export function defaultSettings(): Settings {
  return {
    browserChannel: 'chrome',
    browserPath: '',
    profilesDir: path.join(app.getPath('userData'), 'profiles'),
    defaultStartUrl: 'https://facetbrowser.com/check',
    getipintelContact: '',
    abuseIpDbKey: '',
    proxyCheckConcurrency: 5,
    speedTestBytes: 500000,
    language: 'tr',
    hideAutomationBar: true
  }
}

class Store {
  private file: string
  private data: Data
  private timer: NodeJS.Timeout | null = null

  constructor() {
    this.file = path.join(app.getPath('userData'), 'facetbrowser.json')
    this.data = this.load()
  }

  private load(): Data {
    const empty: Data = { profiles: [], proxies: [], groups: [], settings: defaultSettings() }
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Data>
        return {
          profiles: parsed.profiles || [],
          proxies: parsed.proxies || [],
          groups: parsed.groups || [],
          settings: { ...defaultSettings(), ...(parsed.settings || {}) }
        }
      }
    } catch (e) {
      console.error('store load failed', e)
      try { fs.copyFileSync(this.file, this.file + '.corrupt-' + Date.now()) } catch { /* ignore */ }
    }
    return empty
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 150)
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    const tmp = this.file + '.tmp'
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  get dataFile(): string { return this.file }

  // ---- profiles
  get profiles(): Profile[] { return this.data.profiles }
  getProfile(id: string): Profile | undefined { return this.data.profiles.find((p) => p.id === id) }
  upsertProfile(p: Profile): Profile {
    const i = this.data.profiles.findIndex((x) => x.id === p.id)
    p.updatedAt = Date.now()
    if (i === -1) this.data.profiles.unshift(p)
    else this.data.profiles[i] = p
    this.scheduleSave()
    return p
  }
  deleteProfiles(ids: string[]): void {
    const set = new Set(ids)
    this.data.profiles = this.data.profiles.filter((p) => !set.has(p.id))
    this.scheduleSave()
  }

  // ---- proxies
  get proxies(): SavedProxy[] { return this.data.proxies }
  getProxy(id: string): SavedProxy | undefined { return this.data.proxies.find((p) => p.id === id) }
  upsertProxy(p: SavedProxy): SavedProxy {
    const i = this.data.proxies.findIndex((x) => x.id === p.id)
    p.updatedAt = Date.now()
    if (i === -1) this.data.proxies.unshift(p)
    else this.data.proxies[i] = p
    this.scheduleSave()
    return p
  }
  deleteProxies(ids: string[]): void {
    const set = new Set(ids)
    this.data.proxies = this.data.proxies.filter((p) => !set.has(p.id))
    for (const prof of this.data.profiles) {
      if (prof.proxy.mode === 'saved' && prof.proxy.savedId && set.has(prof.proxy.savedId)) prof.proxy = { mode: 'none' }
    }
    this.scheduleSave()
  }

  // ---- groups
  get groups(): Group[] { return this.data.groups }
  upsertGroup(g: Group): Group {
    const i = this.data.groups.findIndex((x) => x.id === g.id)
    if (i === -1) this.data.groups.push(g)
    else this.data.groups[i] = g
    this.scheduleSave()
    return g
  }
  deleteGroup(id: string): void {
    this.data.groups = this.data.groups.filter((g) => g.id !== id)
    for (const p of this.data.profiles) if (p.groupId === id) delete p.groupId
    this.scheduleSave()
  }

  // ---- settings
  get settings(): Settings { return this.data.settings }
  setSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.scheduleSave()
    return this.data.settings
  }
}

let instance: Store | null = null
export function store(): Store {
  if (!instance) instance = new Store()
  return instance
}

export function uid(prefix = ''): string {
  const s = Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  return prefix ? `${prefix}_${s}` : s
}
