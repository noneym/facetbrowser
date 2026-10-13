import { create } from 'zustand'
import type { AppInfo, Group, Profile, ProxyCheckResult, RunningProfile, SavedProxy, Settings } from '@shared/types'
import { useI18n } from '@/lib/i18n'

export type Page = 'profiles' | 'proxies' | 'checker' | 'settings'

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

  init: () => Promise<void>
  setPage: (p: Page) => void
  refreshProfiles: () => Promise<void>
  refreshProxies: () => Promise<void>
  refreshGroups: () => Promise<void>
  refreshInfo: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  openEditor: (p: Profile | null, isNew: boolean) => void
  closeEditor: () => void
  setProxies: (list: SavedProxy[]) => void
  setProfiles: (list: Profile[]) => void
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

  init: async () => {
    const [settings, profiles, proxies, groups, running, info] = await Promise.all([
      window.api.settings.get(),
      window.api.profiles.list(),
      window.api.proxies.list(),
      window.api.groups.list(),
      window.api.browser.list(),
      window.api.app.info()
    ])
    useI18n.getState().setLang(settings.language)
    set({ settings, profiles, proxies, groups, running, info, ready: true })
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
  },
  setPage: (page) => set({ page }),
  refreshProfiles: async () => set({ profiles: await window.api.profiles.list() }),
  refreshProxies: async () => set({ proxies: await window.api.proxies.list() }),
  refreshGroups: async () => set({ groups: await window.api.groups.list() }),
  refreshInfo: async () => set({ info: await window.api.app.info() }),
  saveSettings: async (patch) => {
    const settings = await window.api.settings.set(patch)
    if (patch.language) useI18n.getState().setLang(patch.language)
    set({ settings })
    if (patch.browserChannel !== undefined || patch.browserPath !== undefined) get().refreshInfo()
  },
  openEditor: (p, isNew) => set({ editorProfile: p, editorIsNew: isNew }),
  closeEditor: () => set({ editorProfile: null, editorIsNew: false }),
  setProxies: (proxies) => set({ proxies }),
  setProfiles: (profiles) => set({ profiles })
}))
