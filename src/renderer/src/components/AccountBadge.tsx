import { CloudCheck, CloudSlash, CloudWarning, ArrowsClockwise } from '@phosphor-icons/react'
import { useApp } from '@/store/app'
import { useT, type Key } from '@/lib/i18n'
import { timeAgo } from '@/lib/format'
import { cx } from './ui'

// Compact account + sync state for the sidebar footer.
export function AccountBadge(): JSX.Element | null {
  const t = useT()
  const cloud = useApp((s) => s.cloud)
  const setPage = useApp((s) => s.setPage)
  if (!cloud?.loggedIn || !cloud.user) return null
  const u = cloud.user
  const planLabel = t(`account.plan.${u.plan}` as Key)
  const problem = !u.emailVerified ? 'email_not_verified' : !u.planActive ? 'plan_inactive' : cloud.lastError
  const Icon = !cloud.online ? CloudSlash : problem ? CloudWarning : CloudCheck
  const color = !cloud.online ? 'var(--color-fg-faint)' : problem ? 'var(--color-warn)' : 'var(--color-ok)'
  return (
    <button onClick={() => setPage('settings')} className="focus-ring flex w-full flex-col gap-1 rounded-[var(--radius-md)] px-1 py-1 text-left hover:bg-surface-2">
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color }} className={cx(cloud.syncing && 'animate-pulse')} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg" title={u.email}>{u.email}</span>
        {cloud.syncing && <ArrowsClockwise size={12} className="animate-spin text-fg-faint" />}
      </div>
      <div className="flex items-center justify-between gap-2 text-[11.5px] text-fg-faint">
        <span className="truncate">{planLabel}{u.plan === 'trial' && u.trialEndsAt ? ` · ${t('account.trialLeft', { n: Math.max(0, Math.ceil((u.trialEndsAt - Date.now()) / 86400000)) })}` : ''}</span>
        <span className="shrink-0">{!cloud.online ? t('account.offline') : cloud.lastSyncAt ? timeAgo(cloud.lastSyncAt) : ''}</span>
      </div>
    </button>
  )
}
