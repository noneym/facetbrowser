import { useEffect } from 'react'
import { useApp } from '@/store/app'
import { Sidebar } from '@/components/Sidebar'
import { Toasts } from '@/components/Toasts'
import { ProfilesPage } from '@/pages/ProfilesPage'
import { ProfileEditor } from '@/pages/ProfileEditor'
import { ProxiesPage } from '@/pages/ProxiesPage'
import { CheckerPage } from '@/pages/CheckerPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SkeletonRows } from '@/components/ui'

export default function App(): JSX.Element {
  const ready = useApp((s) => s.ready)
  const page = useApp((s) => s.page)
  const init = useApp((s) => s.init)

  useEffect(() => {
    init()
  }, [init])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="drag-region h-10 shrink-0" />
        <div className="min-h-0 flex-1">
          {!ready ? (
            <SkeletonRows />
          ) : page === 'profiles' ? (
            <ProfilesPage />
          ) : page === 'proxies' ? (
            <ProxiesPage />
          ) : page === 'checker' ? (
            <CheckerPage />
          ) : (
            <SettingsPage />
          )}
        </div>
      </main>
      <ProfileEditor />
      <Toasts />
    </div>
  )
}
