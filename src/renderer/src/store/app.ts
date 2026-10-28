import { create } from 'zustand'
import { toast } from './toast'
import { t } from '@/lib/i18n'
import type { AppInfo, EngineStatus, Group, Profile, ProxyCheckResult, RunningProfile, SavedProxy, Settings, UpdateStatus, InstalledExtension } from '@shared/types'
import type { CloudStatus } from '@shared/cloud'
import { useI18n } from '@/lib/i18n'

export type Page = 'profiles' | 'proxies' | 'extensions' | 'checker' | 'settings'

interface AppState {
  ready: boolean
  page: Page
  info: AppInfo | null
  settings: Settings | null
  profiles: Profile[]
  proxies: SavedProxy[]
  groups: Group[]
  running: RunningProfile[]
  checking: Record<string, string>
  editorProfile: Profile | null
  editorIsNew: boolean
  cloud: CloudStatus | null
  engine: EngineStatus | null
  update: UpdateStatus | null
  extensions: InstalledExtension[]

  init: () => Promise<void>
  setPage: (p: Page) => void
  refreshProfiles: () => Promise<void>
  refreshProxies: () => Promise<void>
  refreshGroups: () => Promise<void>
  refreshInfo: () => Promise<void>
  refreshAll: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  openEditor: (p: Profile | null, isNew: boolean) => void
  closeEditor: () => void
  setProxies: (list: SavedProxy[]) => void
  setProfiles: (list: Profile[]) => void
  setCloud: (c: CloudStatus) => void
  setEngine: (e: EngineStatus) => void
  setUpdate: (u: UpdateStatus) => void
  setExtensions: (list: InstalledExtension[]) => void
  refreshExtensions: () => Promise<void>
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  page: 'profiles',
  info: null,
  settings: null,
  profiles: [],
  proxies: [],
  groups: [],
  running: [],
  checking: {},
  editorProfile: null,
  editorIsNew: false,
  cloud: null,
  engine: null,
  update: null,
  extensions: [],

  init: async () => {
    const [settings, profiles, proxies, groups, running, info, cloud, engine] = await Promise.all([
      window.api.settings.get(),
      window.api.profiles.list(),
      window.api.proxies.list(),
      window.api.groups.list(),
      window.api.browser.list(),
      window.api.app.info(),
      window.api.cloud.status(),
      window.api.engine.status()
    ])
    useI18n.getState().setLang(settings.language)
    set({ settings, profiles, proxies, groups, running, info, cloud, engine, ready: true })
    window.api.engine.onStatus((engine) => { set({ engine }); get().refreshInfo() })
    window.api.update.status().then((update) => set({ update })).catch(() => {})
    window.api.extensions.list().then((extensions) => set({ extensions })).catch(() => {})
    window.api.update.onStatus((update) => {
      const was = get().update?.state
      set({ update })
      if (update.state === 'ready' && was !== 'ready') toast.info(t('update.readyToast', { v: update.version || '' }))
    })
    window.api.browser.onStatus((running) => {
      set({ running })
      get().refreshProfiles()
    })
    window.api.proxies.onChecking(({ id, stage }) => set((s) => ({ checking: { ...s.checking, [id]: stage } })))
    window.api.proxies.onChecked(({ id, result }: { id: string; result: ProxyCheckResult }) =>
      set((s) => {
        const checking = { ...s.checking }
        delete checking[id]
        return { checking, proxies: s.proxies.map((p) => (p.id === id ? { ...p, lastCheck: result } : p)) }
      })
    )
    window.api.cloud.onStatus((cloud) => set({ cloud }))
    window.api.cloud.onData(() => get().refreshAll())
  },
  setPage: (page) => set({ page }),
  refreshProfiles: async () => set({ profiles: await window.api.profiles.list() }),
  refreshProxies: async () => set({ proxies: await window.api.proxies.list() }),
  refreshGroups: async () => set({ groups: await window.api.groups.list() }),
  refreshInfo: async () => set({ info: await window.api.app.info() }),
  refreshAll: async () => {
    const [profiles, proxies, groups] = await Promise.all([window.api.profiles.list(), window.api.proxies.list(), window.api.groups.list()])
    set({ profiles, proxies, groups })
  },
  saveSettings: async (patch) => {
    const settings = await window.api.settings.set(patch)
    if (patch.language) useI18n.getState().setLang(patch.language)
    set({ settings })
  },
  openEditor: (p, isNew) => set({ editorProfile: p, editorIsNew: isNew }),
  closeEditor: () => set({ editorProfile: null, editorIsNew: false }),
  setProxies: (proxies) => set({ proxies }),
  setProfiles: (profiles) => set({ profiles }),
  setCloud: (cloud) => set({ cloud }),
  setEngine: (engine) => set({ engine }),
  setUpdate: (update) => set({ update }),
  setExtensions: (extensions) => set({ extensions }),
  refreshExtensions: async () => set({ extensions: await window.api.extensions.list() })
}))
