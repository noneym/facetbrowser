import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppInfo, BatchCheckOptions, BatchItemEvent, CookieRecord, Fingerprint, GenerateFingerprintOptions, Group, Profile,
  ProxyCheckResult, ProxyConfig, RunningProfile, SavedProxy, Settings
} from '@shared/types'
import type { EngineStatus, FeaturedExtension, InstalledExtension, UpdateStatus } from '@shared/types'
import type { CloudStatus, ProviderAccount, ProviderBalance, ProviderCountry, ProviderGenerateOptions } from '@shared/cloud'

type Listener<T> = (payload: T) => void
function on<T>(channel: string, cb: Listener<T>): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
    openPath: (p: string): Promise<string> => ipcRenderer.invoke('app:openPath', p),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
    pickFile: (opts: { title?: string; filters?: { name: string; extensions: string[] }[]; directory?: boolean }): Promise<string | null> => ipcRenderer.invoke('app:pickFile', opts),
    saveText: (opts: { defaultPath: string; content: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> => ipcRenderer.invoke('app:saveText', opts),
    readText: (opts: { filters?: { name: string; extensions: string[] }[] }): Promise<{ path: string; content: string } | null> => ipcRenderer.invoke('app:readText', opts)
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch)
  },
  groups: {
    list: (): Promise<Group[]> => ipcRenderer.invoke('groups:list'),
    save: (g: Group): Promise<Group> => ipcRenderer.invoke('groups:save', g),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('groups:delete', id)
  },
  profiles: {
    list: (): Promise<Profile[]> => ipcRenderer.invoke('profiles:list'),
    new: (partial?: Partial<Profile>): Promise<Profile> => ipcRenderer.invoke('profiles:new', partial),
    save: (p: Profile): Promise<Profile> => ipcRenderer.invoke('profiles:save', p),
    delete: (ids: string[], wipeData: boolean): Promise<Profile[]> => ipcRenderer.invoke('profiles:delete', ids, wipeData),
    clone: (id: string, opts: { count: number; newFingerprint: boolean; copyData: boolean }): Promise<Profile[]> => ipcRenderer.invoke('profiles:clone', id, opts),
    export: (ids: string[]): Promise<string | null> => ipcRenderer.invoke('profiles:export', ids),
    import: (): Promise<number> => ipcRenderer.invoke('profiles:import')
  },
  fingerprint: {
    generate: (opts: GenerateFingerprintOptions): Promise<Fingerprint> => ipcRenderer.invoke('fingerprint:generate', opts),
    adaptToProxy: (p: Profile): Promise<Fingerprint> => ipcRenderer.invoke('fingerprint:adaptToProxy', p)
  },
  browser: {
    list: (): Promise<RunningProfile[]> => ipcRenderer.invoke('browser:list'),
    launch: (id: string): Promise<Profile> => ipcRenderer.invoke('browser:launch', id),
    stop: (id: string): Promise<void> => ipcRenderer.invoke('browser:stop', id),
    stopAll: (): Promise<void> => ipcRenderer.invoke('browser:stopAll'),
    onStatus: (cb: Listener<RunningProfile[]>) => on('browser:status', cb)
  },
  cookies: {
    export: (id: string): Promise<CookieRecord[]> => ipcRenderer.invoke('cookies:export', id),
    import: (id: string, text: string): Promise<number> => ipcRenderer.invoke('cookies:import', id, text),
    clear: (id: string): Promise<void> => ipcRenderer.invoke('cookies:clear', id)
  },
  proxies: {
    list: (): Promise<SavedProxy[]> => ipcRenderer.invoke('proxies:list'),
    save: (p: SavedProxy): Promise<SavedProxy> => ipcRenderer.invoke('proxies:save', p),
    delete: (ids: string[]): Promise<SavedProxy[]> => ipcRenderer.invoke('proxies:delete', ids),
    importText: (text: string, tags: string[]): Promise<{ added: number; proxies: SavedProxy[] }> => ipcRenderer.invoke('proxies:importText', text, tags),
    parse: (line: string): Promise<ProxyConfig | null> => ipcRenderer.invoke('proxies:parse', line),
    check: (ids: string[], opts?: { speedTest?: boolean }): Promise<SavedProxy[]> => ipcRenderer.invoke('proxies:check', ids, opts),
    checkConfig: (cfg: ProxyConfig): Promise<ProxyCheckResult> => ipcRenderer.invoke('proxies:checkConfig', cfg),
    onChecking: (cb: Listener<{ id: string; stage: string }>) => on('proxies:checking', cb),
    onChecked: (cb: Listener<{ id: string; result: ProxyCheckResult }>) => on('proxies:checked', cb)
  },
  extensions: {
    list: (): Promise<InstalledExtension[]> => ipcRenderer.invoke('extensions:list'),
    featured: (): Promise<FeaturedExtension[]> => ipcRenderer.invoke('extensions:featured'),
    install: (input: string): Promise<InstalledExtension[]> => ipcRenderer.invoke('extensions:install', input),
    remove: (id: string): Promise<InstalledExtension[]> => ipcRenderer.invoke('extensions:remove', id),
    setAll: (id: string, on: boolean): Promise<InstalledExtension[]> => ipcRenderer.invoke('extensions:setAll', id, on),
    dataProfiles: (id: string): Promise<string[]> => ipcRenderer.invoke('extensions:dataProfiles', id),
    copyData: (id: string, from: string, to: string[]): Promise<{ copied: string[]; skippedRunning: string[]; missing: string[] }> => ipcRenderer.invoke('extensions:copyData', id, from, to),
    setShare: (id: string, from: string | null): Promise<{ list: InstalledExtension[]; copied: string[]; skippedRunning: string[] }> => ipcRenderer.invoke('extensions:setShare', id, from)
  },
  update: {
    status: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
    download: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onStatus: (cb: Listener<UpdateStatus>) => on('update:status', cb)
  },
  engine: {
    status: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:status'),
    install: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:install'),
    remove: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:remove'),
    onStatus: (cb: Listener<EngineStatus>) => on('engine:status', cb)
  },
  cloud: {
    status: (): Promise<CloudStatus> => ipcRenderer.invoke('cloud:status'),
    login: (email: string, password: string): Promise<CloudStatus> => ipcRenderer.invoke('cloud:login', email, password),
    register: (email: string, password: string): Promise<CloudStatus> => ipcRenderer.invoke('cloud:register', email, password),
    logout: (): Promise<CloudStatus> => ipcRenderer.invoke('cloud:logout'),
    me: (): Promise<CloudStatus> => ipcRenderer.invoke('cloud:me'),
    resendVerification: (): Promise<void> => ipcRenderer.invoke('cloud:resendVerification'),
    forgot: (email: string): Promise<void> => ipcRenderer.invoke('cloud:forgot', email),
    syncNow: (): Promise<CloudStatus> => ipcRenderer.invoke('cloud:syncNow'),
    gate: (): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('cloud:gate'),
    onStatus: (cb: Listener<CloudStatus>) => on('cloud:status', cb),
    onData: (cb: Listener<null>) => on('cloud:data', cb)
  },
  providers: {
    meta: (): Promise<Array<{ id: string; name: string; canGenerate: boolean; fields: Array<{ key: string; label: string; secret?: boolean; hint?: string; optional?: boolean }> }>> => ipcRenderer.invoke('providers:meta'),
    accounts: (): Promise<ProviderAccount[]> => ipcRenderer.invoke('providers:accounts'),
    save: (acc: Omit<ProviderAccount, 'createdAt' | 'updatedAt'>): Promise<ProviderAccount[]> => ipcRenderer.invoke('providers:save', acc),
    delete: (id: string): Promise<ProviderAccount[]> => ipcRenderer.invoke('providers:delete', id),
    balance: (id: string): Promise<ProviderBalance> => ipcRenderer.invoke('providers:balance', id),
    countries: (id: string): Promise<ProviderCountry[]> => ipcRenderer.invoke('providers:countries', id),
    generate: (id: string, opts: ProviderGenerateOptions, save: boolean): Promise<{ configs: ProxyConfig[]; saved: SavedProxy[] }> => ipcRenderer.invoke('providers:generate', id, opts, save)
  },
  checker: {
    run: (lines: string[], opts: BatchCheckOptions): Promise<(ProxyCheckResult | null)[]> => ipcRenderer.invoke('checker:run', lines, opts),
    abort: (): Promise<void> => ipcRenderer.invoke('checker:abort'),
    onEvent: (cb: Listener<BatchItemEvent>) => on('checker:event', cb)
  }
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
