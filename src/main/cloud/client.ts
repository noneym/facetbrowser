import os from 'os'
import type { AuthTokens, CloudSession, CookieBlobInfo, LicenseInfo, ProviderAccount, PublicUser, SyncCollection, SyncPushResponse, SyncRecord } from '@shared/cloud'
import type { CookieRecord, StorageOrigin } from '@shared/types'
import { store, uid } from '../store'

export class CloudError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

const DEFAULT_API = 'https://facetbrowser.com'

function apiBase(): string {
  return (store().settings.apiBaseUrl || DEFAULT_API).replace(/\/$/, '')
}

function deviceInfo(): { id: string; name: string; platform: string } {
  const s = store()
  if (!s.cloud.deviceId) s.setCloud({ deviceId: uid('dev') })
  return { id: s.cloud.deviceId, name: os.hostname(), platform: process.platform }
}

let refreshing: Promise<boolean> | null = null

async function request<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const s = store()
  const auth = opts.auth !== false
  const session = s.cloud.session
  if (auth && !session) throw new CloudError(401, 'not_logged_in')
  if (auth && session && session.tokens.expiresAt - Date.now() < 60000) await refreshTokens()

  const doFetch = async (): Promise<Response> => {
    const sess = s.cloud.session
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000)
    try {
      return await fetch(`${apiBase()}/api${path}`, {
        method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
        headers: { 'content-type': 'application/json', 'user-agent': 'FacetBrowser-desktop', ...(auth && sess ? { authorization: `Bearer ${sess.tokens.accessToken}` } : {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal
      })
    } finally {
      clearTimeout(t)
    }
  }
  let res: Response
  try {
    res = await doFetch()
  } catch (e) {
    throw new CloudError(0, `network: ${(e as Error).message}`)
  }
  if (res.status === 401 && auth && (await refreshTokens())) {
    try {
      res = await doFetch()
    } catch (e) {
      throw new CloudError(0, `network: ${(e as Error).message}`)
    }
  }
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const d = data as { error?: string } | null
    throw new CloudError(res.status, d?.error || `http_${res.status}`)
  }
  return data as T
}

export async function refreshTokens(): Promise<boolean> {
  const s = store()
  const session = s.cloud.session
  if (!session) return false
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: session.tokens.refreshToken }) })
        if (res.status === 401) {
          s.setCloud({ session: null })
          return false
        }
        if (!res.ok) return false
        const d = (await res.json()) as { user: PublicUser; tokens: AuthTokens }
        s.setCloud({ session: { ...session, tokens: d.tokens, user: d.user, fetchedAt: Date.now() } })
        return true
      } catch {
        return false
      } finally {
        refreshing = null
      }
    })()
  }
  return refreshing
}

export const cloud = {
  apiBase,
  session: (): CloudSession | null => store().cloud.session,

  async register(email: string, password: string): Promise<CloudSession> {
    const d = await request<{ user: PublicUser; tokens: AuthTokens; deviceId: string }>('/auth/register', { body: { email, password, device: deviceInfo() }, auth: false })
    return saveSession(d)
  },
  async login(email: string, password: string): Promise<CloudSession> {
    const d = await request<{ user: PublicUser; tokens: AuthTokens; deviceId: string }>('/auth/login', { body: { email, password, device: deviceInfo() }, auth: false })
    return saveSession(d)
  },
  async logout(): Promise<void> {
    const s = store()
    const rt = s.cloud.session?.tokens.refreshToken
    s.setCloud({ session: null, lastSyncAt: 0 })
    if (rt) await request('/auth/logout', { body: { refreshToken: rt }, auth: false }).catch(() => {})
  },
  async me(): Promise<LicenseInfo> {
    const info = await request<LicenseInfo>('/me')
    const s = store()
    if (s.cloud.session) s.setCloud({ session: { ...s.cloud.session, user: info.user, fetchedAt: Date.now() } })
    return info
  },
  resendVerification: (): Promise<void> => request('/auth/resend-verification', { method: 'POST' }),
  forgot: (email: string): Promise<void> => request('/auth/forgot', { body: { email }, auth: false }),

  sync: (since: number, changes: Partial<Record<SyncCollection, SyncRecord[]>>): Promise<SyncPushResponse> => request('/sync', { body: { since, changes }, timeoutMs: 60000 }),
  cookieList: (): Promise<CookieBlobInfo[]> => request('/sync/cookies'),
  cookieGet: (profileId: string): Promise<{ profileId: string; updatedAt: number; cookies: CookieRecord[]; storage?: StorageOrigin[] }> => request(`/sync/cookies/${encodeURIComponent(profileId)}`, { timeoutMs: 60000 }),
  cookiePut: (profileId: string, updatedAt: number, cookies: CookieRecord[], storage: StorageOrigin[]): Promise<{ ok: true; skipped: boolean; serverUpdatedAt: number }> => request(`/sync/cookies/${encodeURIComponent(profileId)}`, { method: 'PUT', body: { updatedAt, cookies, storage }, timeoutMs: 60000 }),
  cookieDelete: (profileId: string): Promise<void> => request(`/sync/cookies/${encodeURIComponent(profileId)}`, { method: 'DELETE' }),

  providerAccounts: (): Promise<ProviderAccount[]> => request('/proxy-accounts'),
  providerAccountSave: (acc: Omit<ProviderAccount, 'createdAt' | 'updatedAt'>): Promise<{ id: string }> => request(`/proxy-accounts/${acc.id || 'new'}`, { method: 'PUT', body: { provider: acc.provider, label: acc.label, credentials: acc.credentials } }),
  providerAccountDelete: (id: string): Promise<void> => request(`/proxy-accounts/${id}`, { method: 'DELETE' })
}

function saveSession(d: { user: PublicUser; tokens: AuthTokens; deviceId: string }): CloudSession {
  const s = store()
  const session: CloudSession = { apiBase: apiBase(), deviceId: d.deviceId, tokens: d.tokens, user: d.user, fetchedAt: Date.now() }
  s.setCloud({ session, deviceId: d.deviceId, lastSyncAt: 0 })
  return session
}
