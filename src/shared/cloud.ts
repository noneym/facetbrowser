// Types mirrored from facetbrowser-web/shared/api.ts (keep in sync).

export type PlanId = 'trial' | 'starter' | 'unlimited'

export interface PublicUser {
  id: string
  email: string
  emailVerified: boolean
  plan: PlanId
  planActive: boolean
  trialEndsAt: number | null
  purchasedAt: number | null
  profileLimit: number | null
  createdAt: number
}

export interface LicenseInfo {
  user: PublicUser
  profileCount: number
  deviceCount: number
  serverTime: number
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type SyncCollection = 'profiles' | 'proxies' | 'groups'

export interface SyncRecord {
  id: string
  updatedAt: number
  deletedAt: number | null
  data: unknown
}

export interface SyncPushResponse {
  now: number
  changes: Record<SyncCollection, SyncRecord[]>
  rejected: Array<{ collection: SyncCollection; id: string; reason: string }>
}

export interface CookieBlobInfo {
  profileId: string
  updatedAt: number
  deviceId: string
  size: number
}

export interface CloudSession {
  apiBase: string
  deviceId: string
  tokens: AuthTokens
  user: PublicUser
  fetchedAt: number // when `user` was last confirmed by the server
}

export interface CloudStatus {
  loggedIn: boolean
  user: PublicUser | null
  online: boolean
  lastSyncAt: number
  syncing: boolean
  lastError: string | null
  offlineGraceUntil: number | null
}

export type ProviderId = 'gonzoproxy' | '2captcha'

export interface ProviderAccount {
  id: string
  provider: ProviderId
  label: string
  credentials: Record<string, string>
  createdAt: number
  updatedAt: number
}

export interface ProviderBalance {
  ok: boolean
  error?: string
  lines: Array<{ label: string; value: string }>
}

export interface ProviderGenerateOptions {
  country?: string
  state?: string
  city?: string
  count: number
  sticky: boolean
  ttlHours?: number
}

export interface ProviderCountry {
  code: string
  name: string
}
