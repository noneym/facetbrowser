import { UserCircle, Globe, Pulse, GearSix, Warning } from '@phosphor-icons/react'
import { useApp, type Page } from '@/store/app'
import { useT } from '@/lib/i18n'
import { cx } from './ui'
import { AccountBadge } from './AccountBadge'
import { Logo } from './Logo'

export function Sidebar(): JSX.Element {
  const t = useT()
  const page = useApp((s) => s.page)
  const setPage = useApp((s) => s.setPage)
  const running = useApp((s) => s.running)
  const info = useApp((s) => s.info)
  const profiles = useApp((s) => s.profiles)
  const proxies = useApp((s) => s.proxies)

  const items: Array<{ id: Page; label: string; icon: JSX.Element; count?: number }> = [
    { id: 'profiles', label: t('nav.profiles'), icon: <UserCircle size={18} />, count: profiles.length },
    { id: 'proxies', label: t('nav.proxies'), icon: <Globe size={18} />, count: proxies.length },
    { id: 'checker', label: t('nav.checker'), icon: <Pulse size={18} /> },
    { id: 'settings', label: t('nav.settings'), icon: <GearSix size={18} /> }
  ]

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div className="drag-region flex h-10 items-center gap-2 px-4">
        <span className="no-drag flex items-center gap-2">
          <Logo size={22} />
          <span className="text-[13px] font-semibold tracking-tight">FacetBrowser</span>
        </span>
      </div>

      <nav className="mt-2 flex flex-col gap-0.5 px-2">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setPage(it.id)}
            className={cx(
              'focus-ring flex h-9 items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 text-[13px] transition-colors',
              page === it.id ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
            )}
          >
            <span className={page === it.id ? 'text-accent' : ''}>{it.icon}</span>
            <span className="flex-1 text-left">{it.label}</span>
            {it.count !== undefined && it.count > 0 && <span className="font-mono text-[11px] text-fg-faint">{it.count}</span>}
          </button>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-line p-3 text-[12px]">
        <AccountBadge />
        {running.length > 0 && (
          <div className="flex items-center gap-2 text-fg-muted">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="font-mono text-fg">{running.length}</span> {t('nav.running')}
          </div>
        )}
        {info && !info.browserFound && (
          <button onClick={() => setPage('settings')} className="flex items-center gap-2 text-warn hover:underline">
            <Warning size={14} /> {t('nav.browserMissing')}
          </button>
        )}
        {info && info.browserFound && (
          <div className="truncate text-fg-faint" title={info.browserPath}>
            {t('nav.browser')}: <span className="font-mono">{info.browserVersion.split('.')[0] || '?'}</span>
          </div>
        )}
      </div>
    </aside>
  )
}
