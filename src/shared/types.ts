// Shared types between main, preload and renderer.

export type ProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5'

export interface ProxyConfig {
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  password?: string
}

export type Anonymity = 'elite' | 'anonymous' | 'transparent' | 'unknown'
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

export interface ProxyCheckResult {
  checkedAt: number
  ok: boolean
  error?: string
  ip?: string
  latencyMs?: number
  latencySamples?: number[]
  jitterMs?: number
  downloadKbps?: number
  country?: string
  countryCode?: string
  region?: string
  city?: string
  isp?: string
  org?: string
  asn?: string
  timezone?: string
  lat?: number
  lon?: number
  isProxy?: boolean
  isHosting?: boolean
  isMobile?: boolean
  anonymity?: Anonymity
  leakedHeaders?: string[]
  abuseScore?: number | null
  abuseReports?: number | null
  abuseLastReportedAt?: string | null
  abuseUsageType?: string | null
  abuseIsTor?: boolean
  residentialScore?: number | null
  combinedScore?: number | null
  fraudScore?: number | null
  fraudProvider?: string | null
  quality?: number
  grade?: Grade
  verdict?: string
  issues?: string[]
}

export interface SavedProxy extends ProxyConfig {
  id: string
  name: string
  tags: string[]
  createdAt: number
  updatedAt: number
  lastCheck?: ProxyCheckResult
}

export type OsFamily = 'windows' | 'macos' | 'linux' | 'android'
export type NoiseMode = 'noise' | 'off' | 'real'
export type WebRtcMode = 'altered' | 'disabled' | 'real'

export interface Fingerprint {
  seed: number
  os: OsFamily
  browserVersion: string
  userAgent: string
  platform: string
  vendor: string
  languages: string[]
  locale: string
  timezone: string | 'auto'
  geolocation: { mode: 'auto' | 'custom' | 'off' | 'prompt'; lat?: number; lon?: number; accuracy?: number }
  screen: { width: number; height: number; colorDepth: number; pixelRatio: number }
  hardwareConcurrency: number
  deviceMemory: number
  maxTouchPoints: number
  webgl: { vendor: string; renderer: string; mode: NoiseMode }
  canvas: NoiseMode
  audio: NoiseMode
  clientRects: NoiseMode
  webrtc: WebRtcMode
  fonts: 'mask' | 'real'
  mediaDevices: { audioInputs: number; audioOutputs: number; videoInputs: number }
  doNotTrack: boolean | null
  cpuArch: 'x86' | 'arm'
  batteryMask: boolean
}

export interface ProfileProxy {
  mode: 'none' | 'saved' | 'custom'
  savedId?: string
  custom?: ProxyConfig
}

export interface Profile {
  id: string
  name: string
  notes: string
  tags: string[]
  groupId?: string
  color: string
  favorite: boolean
  proxy: ProfileProxy
  fingerprint: Fingerprint
  startUrls: string[]
  lastTabs?: string[] // tabs open when the profile was last closed; reopened on launch
  extensions: string[] // unpacked extension folders (advanced)
  extensionIds?: string[] // Web Store extensions picked for this profile (on top of the ones enabled for all)
  createdAt: number
  updatedAt: number
  lastLaunchedAt?: number
  launchCount: number
  cookieCount?: number
}

export interface Group {
  id: string
  name: string
  color: string
  updatedAt?: number
}

export interface Settings {
  profilesDir: string
  defaultStartUrl: string
  restoreTabs: boolean // reopen last session's tabs instead of the start page
  getipintelContact: string
  abuseIpDbKey: string
  proxyCheckConcurrency: number
  speedTestBytes: number
  language: 'tr' | 'en'
  apiBaseUrl: string
}

export type RunState = 'starting' | 'running' | 'stopping'

export interface RunningProfile {
  profileId: string
  state: RunState
  startedAt: number
  bridgePort?: number
  pages?: number
}

export interface BatchCheckOptions {
  contact: string
  abuseKey: string
  skipReported: boolean
  speedTest: boolean
  concurrency: number
}

export interface BatchItemEvent {
  index: number
  raw: string
  stage: 'queued' | 'connecting' | 'enriching' | 'scoring' | 'done' | 'failed'
  result?: ProxyCheckResult
}

export interface GenerateFingerprintOptions {
  os?: OsFamily
  seed?: number
  browserVersion?: string
}

export interface ProfileExport {
  version: 1
  exportedAt: number
  profiles: Profile[]
  proxies: SavedProxy[]
  groups: Group[]
}

export interface EngineStatus {
  supported: boolean
  installed: boolean
  installedVersion: string | null
  exePath: string | null
  latest: { version: string; file: string; url: string } | null
  downloading: boolean
  progress: number
  error: string | null
}

// A Chrome Web Store extension downloaded into <userData>/extensions/<id>.
export interface InstalledExtension {
  id: string
  name: string
  version: string
  dir: string
  icon?: string // data URL
  enabledForAll: boolean // loaded in every profile; otherwise only where picked
  shareFrom?: string // profile id whose copy of this extension's store is copied into every other profile at launch
  installedAt: number
}

export interface FeaturedExtension {
  id: string
  name: string
  blurb: [string, string] // tr, en
  highlight?: boolean
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported'
  version?: string
  progress?: number
  error?: string
  checkedAt?: number
}

export interface AppInfo {
  version: string
  platform: string
  dataDir: string
  engineInstalled: boolean
  engineVersion: string
}

// One origin's localStorage, carried next to the cookies in the account jar.
export interface StorageOrigin {
  origin: string
  items: Record<string, string>
}

export interface SessionJar {
  cookies: CookieRecord[]
  storage: StorageOrigin[]
}

// One origin's localStorage, carried next to the cookies in the account jar.
export interface StorageOrigin {
  origin: string
  items: Record<string, string>
}

export interface SessionJar {
  cookies: CookieRecord[]
  storage: StorageOrigin[]
}

export interface CookieRecord {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}
