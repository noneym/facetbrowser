import { EventEmitter } from 'events'
import type { CloudStatus, SyncCollection, SyncRecord } from '@shared/cloud'
import type { Group, Profile, SavedProxy } from '@shared/types'
import { store } from '../store'
import { cloud, CloudError } from './client'
import { launcher } from '../browser/launcher'

const OFFLINE_GRACE_MS = 7 * 86400000
const PERIOD_MS = 60000
const COOKIE_PERIOD_MS = 45000

// Keeps local store and the account in step. Last-write-wins per record on
// `updatedAt`; deletions travel as tombstones. The session jar (cookies plus
// localStorage) is handled per profile: uploaded while a profile runs and on
// stop, downloaded before launch when the server copy is newer.
class SyncEngine extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private cookieTimer: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null
  private running = false
  private online = true
  private lastError: string | null = null
  private cookieBusy = new Set<string>()

  start(): void {
    this.stop()
    this.timer = setInterval(() => this.run().catch(() => {}), PERIOD_MS)
    this.cookieTimer = setInterval(() => this.uploadRunningCookies().catch(() => {}), COOKIE_PERIOD_MS)
    // On stop: a quick read from the live browser first (beforeStop), then a
    // full read from disk once it has closed (covers tabs closed earlier).
    launcher.on('closed', (id: string) => this.uploadCookies(id).catch(() => {}))
    launcher.on('beforeStop', (id: string) => this.uploadCookies(id).catch(() => {}))
    this.run().catch(() => {})
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.cookieTimer) clearInterval(this.cookieTimer)
    this.timer = null
    this.cookieTimer = null
  }

  status(): CloudStatus {
    const s = store()
    const session = s.cloud.session
    return {
      loggedIn: !!session,
      user: session?.user || null,
      online: this.online,
      lastSyncAt: s.cloud.lastSyncAt,
      syncing: this.running,
      lastError: this.lastError,
      offlineGraceUntil: session ? session.fetchedAt + OFFLINE_GRACE_MS : null
    }
  }

  // Why launching may be refused: no account, unverified, plan ended, offline too long.
  licenseGate(): { ok: boolean; reason?: string } {
    const session = store().cloud.session
    if (!session) return { ok: false, reason: 'not_logged_in' }
    if (!session.user.emailVerified) return { ok: false, reason: 'email_not_verified' }
    if (!session.user.planActive) return { ok: false, reason: 'plan_inactive' }
    if (!this.online && Date.now() > session.fetchedAt + OFFLINE_GRACE_MS) return { ok: false, reason: 'offline_too_long' }
    return { ok: true }
  }

  profileLimit(): number | null {
    return store().cloud.session?.user.profileLimit ?? null
  }

  // Called by the store whenever local data changes.
  touch(): void {
    if (!store().cloud.session) return
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => this.run().catch(() => {}), 2500)
  }

  async run(): Promise<void> {
    const s = store()
    if (!s.cloud.session || this.running) return
    this.running = true
    this.emit('status', this.status())
    try {
      const since = s.cloud.lastSyncAt
      const changes = this.collectLocalChanges(since)
      const res = await cloud.sync(since, changes)
      this.applyRemote(res.changes)
      for (const r of res.rejected) {
        if (r.reason === 'profile_limit') this.lastError = 'profile_limit'
      }
      s.setCloud({ lastSyncAt: res.now, tombstones: s.cloud.tombstones.filter((t) => t.deletedAt > res.now) })
      if (!res.rejected.length) this.lastError = null
      this.online = true
      // Refresh license info now and then.
      if (Date.now() - s.cloud.session.fetchedAt > 10 * 60000) await cloud.me().catch(() => {})
    } catch (e) {
      const err = e as CloudError
      if (err.status === 0) this.online = false
      else if (err.status === 401) { /* session dropped by refresh logic */ }
      else if (err.status === 402 || err.status === 403) {
        this.lastError = err.code
        await cloud.me().catch(() => {})
      } else this.lastError = err.code || err.message
    } finally {
      this.running = false
      this.emit('status', this.status())
    }
  }

  private collectLocalChanges(since: number): Partial<Record<SyncCollection, SyncRecord[]>> {
    const s = store()
    const out: Partial<Record<SyncCollection, SyncRecord[]>> = { profiles: [], proxies: [], groups: [] }
    for (const p of s.profiles) if (p.updatedAt > since) out.profiles!.push({ id: p.id, updatedAt: p.updatedAt, deletedAt: null, data: stripLocal(p) })
    for (const p of s.proxies) if (p.updatedAt > since) out.proxies!.push({ id: p.id, updatedAt: p.updatedAt, deletedAt: null, data: p })
    for (const g of s.groups) if ((g.updatedAt || 0) > since) out.groups!.push({ id: g.id, updatedAt: g.updatedAt || Date.now(), deletedAt: null, data: g })
    for (const t of s.cloud.tombstones) if (t.deletedAt > since) out[t.collection]!.push({ id: t.id, updatedAt: t.deletedAt, deletedAt: t.deletedAt, data: null })
    return out
  }

  private applyRemote(changes: Record<SyncCollection, SyncRecord[]>): void {
    const s = store()
    let changed = false
    for (const rec of changes.profiles) {
      const local = s.getProfile(rec.id)
      if (rec.deletedAt) {
        if (local && local.updatedAt <= rec.updatedAt) { s.deleteProfiles([rec.id], false, { silent: true }); changed = true }
        continue
      }
      if (!local || local.updatedAt < rec.updatedAt) {
        const remote = rec.data as Profile
        s.upsertProfile({ ...remote, updatedAt: rec.updatedAt, cookieCount: local?.cookieCount }, { silent: true, keepUpdatedAt: true })
        changed = true
      }
    }
    for (const rec of changes.proxies) {
      const local = s.getProxy(rec.id)
      if (rec.deletedAt) {
        if (local && local.updatedAt <= rec.updatedAt) { s.deleteProxies([rec.id], { silent: true }); changed = true }
        continue
      }
      if (!local || local.updatedAt < rec.updatedAt) {
        s.upsertProxy({ ...(rec.data as SavedProxy), updatedAt: rec.updatedAt }, { silent: true, keepUpdatedAt: true })
        changed = true
      }
    }
    for (const rec of changes.groups) {
      const local = s.groups.find((g) => g.id === rec.id)
      if (rec.deletedAt) {
        if (local) { s.deleteGroup(rec.id, { silent: true }); changed = true }
        continue
      }
      if (!local || (local.updatedAt || 0) < rec.updatedAt) {
        s.upsertGroup({ ...(rec.data as Group), updatedAt: rec.updatedAt }, { silent: true })
        changed = true
      }
    }
    if (changed) this.emit('data')
  }

  // ---- cookies ---------------------------------------------------------
  private async uploadRunningCookies(): Promise<void> {
    for (const r of launcher.list()) if (r.state === 'running') await this.uploadCookies(r.profileId).catch(() => {})
  }

  async uploadCookies(profileId: string): Promise<void> {
    const s = store()
    if (!s.cloud.session || this.cookieBusy.has(profileId)) return
    const profile = s.getProfile(profileId)
    if (!profile) return
    this.cookieBusy.add(profileId)
    try {
      const jar = await launcher.exportSession(profile, s.settings, s.storageOrigins(profileId))
      s.addStorageOrigins(profileId, jar.storage.map((o) => o.origin))
      const now = Date.now()
      const r = await cloud.cookiePut(profileId, now, jar.cookies, jar.storage)
      const prev = s.cloud.cookieSync[profileId] || { localAt: 0, serverAt: 0 }
      s.setCookieSync(profileId, { localAt: now, serverAt: r.skipped ? Math.max(prev.serverAt, r.serverUpdatedAt) : now })
      if (profile.cookieCount !== jar.cookies.length) s.upsertProfile({ ...profile, cookieCount: jar.cookies.length }, { silent: true, keepUpdatedAt: true })
    } finally {
      this.cookieBusy.delete(profileId)
    }
  }

  // Before launch: pull the server jar if another device saved a newer one.
  async pullCookiesIfNewer(profileId: string): Promise<boolean> {
    const s = store()
    if (!s.cloud.session) return false
    const profile = s.getProfile(profileId)
    if (!profile) return false
    const list = await cloud.cookieList().catch(() => null)
    if (!list) return false
    const remote = list.find((c) => c.profileId === profileId)
    if (!remote) return false
    const local = s.cloud.cookieSync[profileId] || { localAt: 0, serverAt: 0 }
    if (remote.updatedAt <= local.serverAt || remote.deviceId === s.cloud.deviceId) return false
    const blob = await cloud.cookieGet(profileId)
    const storage = Array.isArray(blob.storage) ? blob.storage : []
    await launcher.importSession(profile, s.settings, { cookies: blob.cookies, storage })
    s.addStorageOrigins(profileId, storage.map((o) => o.origin))
    s.setCookieSync(profileId, { localAt: blob.updatedAt, serverAt: blob.updatedAt })
    return true
  }
}

function stripLocal(p: Profile): Omit<Profile, 'cookieCount'> {
  const { cookieCount: _c, ...rest } = p
  return rest
}

export const sync = new SyncEngine()
