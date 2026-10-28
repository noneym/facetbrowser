import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import type { Group, Profile, SavedProxy, Settings } from '@shared/types'
import type { CloudSession, SyncCollection } from '@shared/cloud'

export interface Tombstone {
  collection: SyncCollection
  id: string
  deletedAt: number
}

export interface CloudState {
  session: CloudSession | null
  deviceId: string
  lastSyncAt: number
  tombstones: Tombstone[]
  cookieSync: Record<string, { localAt: number; serverAt: number }>
  // Origins whose localStorage we have seen per profile; read back when the
  // profile is not running (Chromium has no 'list all origins' API).
  storageOrigins: Record<string, string[]>
}

interface Data {
  profiles: Profile[]
  proxies: SavedProxy[]
  groups: Group[]
  settings: Settings
  cloud: CloudState
}

interface WriteOpts {
  silent?: boolean // change came from the server: do not re-trigger sync
  keepUpdatedAt?: boolean
}

export function defaultSettings(): Settings {
  return {
    profilesDir: path.join(app.getPath('userData'), 'profiles'),
    defaultStartUrl: 'https://facetbrowser.com/check',
    restoreTabs: true,
    getipintelContact: '',
    abuseIpDbKey: '',
    proxyCheckConcurrency: 5,
    speedTestBytes: 500000,
    language: 'tr',
    apiBaseUrl: 'https://facetbrowser.com'
  }
}

function defaultCloud(): CloudState {
  return { session: null, deviceId: '', lastSyncAt: 0, tombstones: [], cookieSync: {}, storageOrigins: {} }
}

class Store extends EventEmitter {
  private file: string
  private data: Data
  private timer: NodeJS.Timeout | null = null

  constructor() {
    super()
    this.file = path.join(app.getPath('userData'), 'facetbrowser.json')
    this.data = this.load()
  }

  private load(): Data {
    const empty: Data = { profiles: [], proxies: [], groups: [], settings: defaultSettings(), cloud: defaultCloud() }
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Data>
        return {
          profiles: parsed.profiles || [],
          proxies: parsed.proxies || [],
          groups: parsed.groups || [],
          settings: { ...defaultSettings(), ...(parsed.settings || {}) },
          cloud: { ...defaultCloud(), ...(parsed.cloud || {}) }
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

  private changed(opts?: WriteOpts): void {
    this.scheduleSave()
    if (!opts?.silent) this.emit('local-change')
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
  upsertProfile(p: Profile, opts?: WriteOpts): Profile {
    const i = this.data.profiles.findIndex((x) => x.id === p.id)
    if (!opts?.keepUpdatedAt) p.updatedAt = Date.now()
    if (i === -1) this.data.profiles.unshift(p)
    else this.data.profiles[i] = p
    this.changed(opts)
    return p
  }
  deleteProfiles(ids: string[], _wipe?: boolean, opts?: WriteOpts): void {
    const set = new Set(ids)
    this.data.profiles = this.data.profiles.filter((p) => !set.has(p.id))
    if (!opts?.silent) for (const id of ids) this.addTombstone('profiles', id)
    for (const id of ids) {
      delete this.data.cloud.cookieSync[id]
      delete this.data.cloud.storageOrigins[id]
    }
    this.changed(opts)
  }

  // ---- proxies
  get proxies(): SavedProxy[] { return this.data.proxies }
  getProxy(id: string): SavedProxy | undefined { return this.data.proxies.find((p) => p.id === id) }
  upsertProxy(p: SavedProxy, opts?: WriteOpts): SavedProxy {
    const i = this.data.proxies.findIndex((x) => x.id === p.id)
    if (!opts?.keepUpdatedAt) p.updatedAt = Date.now()
    if (i === -1) this.data.proxies.unshift(p)
    else this.data.proxies[i] = p
    this.changed(opts)
    return p
  }
  deleteProxies(ids: string[], opts?: WriteOpts): void {
    const set = new Set(ids)
    this.data.proxies = this.data.proxies.filter((p) => !set.has(p.id))
    for (const prof of this.data.profiles) {
      if (prof.proxy.mode === 'saved' && prof.proxy.savedId && set.has(prof.proxy.savedId)) {
        prof.proxy = { mode: 'none' }
        if (!opts?.silent) prof.updatedAt = Date.now()
      }
    }
    if (!opts?.silent) for (const id of ids) this.addTombstone('proxies', id)
    this.changed(opts)
  }

  // ---- groups
  get groups(): Group[] { return this.data.groups }
  upsertGroup(g: Group, opts?: WriteOpts): Group {
    const i = this.data.groups.findIndex((x) => x.id === g.id)
    if (!opts?.silent) g.updatedAt = Date.now()
    if (i === -1) this.data.groups.push(g)
    else this.data.groups[i] = g
    this.changed(opts)
    return g
  }
  deleteGroup(id: string, opts?: WriteOpts): void {
    this.data.groups = this.data.groups.filter((g) => g.id !== id)
    for (const p of this.data.profiles) if (p.groupId === id) { delete p.groupId; if (!opts?.silent) p.updatedAt = Date.now() }
    if (!opts?.silent) this.addTombstone('groups', id)
    this.changed(opts)
  }

  // ---- settings
  get settings(): Settings { return this.data.settings }
  setSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.scheduleSave()
    return this.data.settings
  }

  // ---- cloud
  get cloud(): CloudState { return this.data.cloud }
  setCloud(patch: Partial<CloudState>): CloudState {
    this.data.cloud = { ...this.data.cloud, ...patch }
    this.scheduleSave()
    return this.data.cloud
  }
  setCookieSync(profileId: string, v: { localAt: number; serverAt: number }): void {
    this.data.cloud.cookieSync[profileId] = v
    this.scheduleSave()
  }
  storageOrigins(profileId: string): string[] {
    return this.data.cloud.storageOrigins?.[profileId] || []
  }
  addStorageOrigins(profileId: string, origins: string[]): void {
    if (!origins.length) return
    if (!this.data.cloud.storageOrigins) this.data.cloud.storageOrigins = {}
    const set = new Set([...(this.data.cloud.storageOrigins[profileId] || []), ...origins])
    this.data.cloud.storageOrigins[profileId] = [...set].slice(-500)
    this.scheduleSave()
  }
  private addTombstone(collection: SyncCollection, id: string): void {
    this.data.cloud.tombstones = this.data.cloud.tombstones.filter((t) => !(t.collection === collection && t.id === id))
    this.data.cloud.tombstones.push({ collection, id, deletedAt: Date.now() })
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
