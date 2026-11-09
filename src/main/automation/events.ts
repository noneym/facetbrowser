import { EventEmitter } from 'events'
import type { Response } from 'playwright-core'
import type { AutomationEvent, AutomationEventType, NetworkRecord } from '@shared/automation'

// Every page event lands here as `{ profileId, tabId, type, ts, data }`. The
// WebSocket stream and (later) MCP notifications subscribe to 'event'; the
// console_read and network_list tools read the per-profile ring buffers.
//
// Three rings per profile (console-ish, network, lifecycle), 2000 entries
// each, so a chatty network cannot push the console history out.

export const RING_SIZE = 2000
export const BODY_MAX = 2 * 1024 * 1024

type Group = 'console' | 'network' | 'lifecycle'

const GROUP_OF: Record<AutomationEventType, Group> = {
  console: 'console',
  pageerror: 'console',
  dialog: 'console',
  request: 'network',
  response: 'network',
  requestfailed: 'network',
  framenavigated: 'lifecycle',
  page: 'lifecycle',
  close: 'lifecycle'
}

export const EVENT_TYPES = Object.keys(GROUP_OF) as AutomationEventType[]

export interface EventFilter {
  tabId?: string
  types?: AutomationEventType[]
  since?: number // seq, exclusive
  last?: number
}

export interface NetworkFilter {
  tabId?: string
  url?: string // substring, or /regex/flags
  method?: string
  status?: number
  type?: string // resourceType
  last?: number
}

export interface NetEntry {
  record: NetworkRecord
  response: Response | null
}

class EventHub extends EventEmitter {
  private seq = 0
  private rings = new Map<string, Record<Group, AutomationEvent[]>>()
  private network = new Map<string, Map<string, NetEntry>>()
  private reqSeq = 0

  private ringsOf(profileId: string): Record<Group, AutomationEvent[]> {
    let r = this.rings.get(profileId)
    if (!r) {
      r = { console: [], network: [], lifecycle: [] }
      this.rings.set(profileId, r)
    }
    return r
  }

  push(profileId: string, tabId: string | null, type: AutomationEventType, data: Record<string, unknown>): AutomationEvent {
    const ev: AutomationEvent = { seq: ++this.seq, ts: Date.now(), profileId, tabId, type, data }
    const ring = this.ringsOf(profileId)[GROUP_OF[type]]
    ring.push(ev)
    if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE)
    this.emit('event', ev)
    return ev
  }

  list(profileId: string, f: EventFilter = {}): AutomationEvent[] {
    const r = this.rings.get(profileId)
    if (!r) return []
    const wanted = f.types && f.types.length ? f.types : EVENT_TYPES
    const groups = new Set<Group>(wanted.map((t) => GROUP_OF[t]))
    let all: AutomationEvent[] = []
    for (const g of groups) all = all.concat(r[g])
    all.sort((a, b) => a.seq - b.seq)
    const types = new Set(wanted)
    let out = all.filter((e) => types.has(e.type) && (!f.tabId || e.tabId === f.tabId) && (f.since === undefined || e.seq > f.since))
    if (f.last && f.last > 0 && out.length > f.last) out = out.slice(out.length - f.last)
    return out
  }

  clear(profileId: string, types?: AutomationEventType[]): void {
    const r = this.rings.get(profileId)
    if (!r) return
    if (!types || !types.length) {
      r.console = []
      r.network = []
      r.lifecycle = []
      this.network.delete(profileId)
      return
    }
    const set = new Set(types)
    for (const g of Object.keys(r) as Group[]) r[g] = r[g].filter((e) => !set.has(e.type))
  }

  // Profile closed: the rings stay readable until the next launch so an agent
  // can still read the last errors; the network bodies (Playwright Response
  // handles) are released now.
  release(profileId: string): void {
    this.network.delete(profileId)
  }

  // ---- network ----------------------------------------------------------
  newRequestId(): string {
    return `r_${(++this.reqSeq).toString(36)}`
  }

  recordRequest(record: NetworkRecord, response: Response | null = null): void {
    let m = this.network.get(record.profileId)
    if (!m) {
      m = new Map()
      this.network.set(record.profileId, m)
    }
    m.set(record.requestId, { record, response })
    if (m.size > RING_SIZE) {
      const first = m.keys().next().value
      if (first !== undefined) m.delete(first)
    }
  }

  updateRequest(profileId: string, requestId: string, patch: Partial<NetworkRecord>, response?: Response | null): void {
    const e = this.network.get(profileId)?.get(requestId)
    if (!e) return
    Object.assign(e.record, patch)
    if (response !== undefined) e.response = response
  }

  networkList(profileId: string, f: NetworkFilter = {}): NetworkRecord[] {
    const m = this.network.get(profileId)
    if (!m) return []
    const urlRe = f.url ? toRegex(f.url) : null
    const needle = f.url ? f.url.toLowerCase() : ''
    let out = [...m.values()]
      .map((e) => e.record)
      .filter((r) => {
        if (f.tabId && r.tabId !== f.tabId) return false
        if (f.method && r.method.toUpperCase() !== f.method.toUpperCase()) return false
        if (f.status !== undefined && r.status !== f.status) return false
        if (f.type && r.resourceType !== f.type) return false
        if (f.url) {
          if (urlRe) return urlRe.test(r.url)
          return r.url.toLowerCase().includes(needle)
        }
        return true
      })
    if (f.last && f.last > 0 && out.length > f.last) out = out.slice(out.length - f.last)
    return out
  }

  networkRecord(requestId: string): NetEntry | undefined {
    for (const m of this.network.values()) {
      const e = m.get(requestId)
      if (e) return e
    }
    return undefined
  }
}

// "/pattern/flags" → RegExp; anything else is a plain substring.
function toRegex(s: string): RegExp | null {
  const m = /^\/(.+)\/([a-z]*)$/.exec(s)
  if (!m) return null
  try {
    return new RegExp(m[1], m[2])
  } catch {
    return null
  }
}

export const events = new EventHub()
