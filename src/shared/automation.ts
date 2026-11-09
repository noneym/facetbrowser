// Types shared by the Automation API (main), the renderer's Settings page and
// later the MCP server. Everything an agent sees over REST/WS is defined here.

export type AutomationEventType =
  | 'console'
  | 'pageerror'
  | 'dialog'
  | 'request'
  | 'response'
  | 'requestfailed'
  | 'framenavigated'
  | 'page'
  | 'close'

export interface AutomationEvent {
  seq: number // monotonic per app run; `since` filters use it
  ts: number
  profileId: string
  tabId: string | null
  type: AutomationEventType
  data: Record<string, unknown>
}

export interface AutomationStatus {
  running: boolean
  port: number | null
  error: string | null
  discoveryFile: string
}

export interface TabInfo {
  tabId: string
  profileId: string
  url: string
  title: string
  active: boolean // last tab brought to front / most recently created
}

export type AutomationProfileState = 'idle' | 'starting' | 'running' | 'stopping'

export interface AutomationProfileInfo {
  id: string
  name: string
  groupId?: string
  group?: string
  tags: string[]
  proxy: { mode: 'none' | 'saved' | 'custom'; country?: string; host?: string }
  state: AutomationProfileState
  tabs: number
  startedAt?: number
  cdpUrl?: string // only when Settings > Automation > expose CDP is on
}

export interface NetworkRecord {
  requestId: string
  profileId: string
  tabId: string | null
  method: string
  url: string
  resourceType: string
  status?: number
  statusText?: string
  ok?: boolean
  failure?: string
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  size?: number
  startedAt: number
  finishedAt?: number
  durationMs?: number
}

export interface DiscoveryFile {
  port: number
  token: string
  pid: number
  version: string
}
