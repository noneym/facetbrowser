import { useEffect, useState } from 'react'
import { FolderOpen, ArrowSquareOut } from '@phosphor-icons/react'
import type { Settings } from '@shared/types'
import { useApp } from '@/store/app'
import { useT } from '@/lib/i18n'
import { toast } from '@/store/toast'
import { Button, Field, Input, Select, Modal } from '@/components/ui'
import type { Key } from '@/lib/i18n'
import { timeAgo } from '@/lib/format'

export function SettingsPage(): JSX.Element {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const info = useApp((s) => s.info)
  const saveSettings = useApp((s) => s.saveSettings)
  const [draft, setDraft] = useState<Settings>(settings)
  const [saving, setSaving] = useState(false)

  useEffect(() => setDraft(settings), [settings])
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => setDraft((d) => ({ ...d, [k]: v }))

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await saveSettings(draft)
      toast.ok(t('settings.saved'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 pb-16 pt-2">
        <header className="flex items-end justify-between">
          <h1 className="text-[20px] font-semibold tracking-tight">{t('settings.title')}</h1>
          <Button variant="primary" onClick={save} disabled={!dirty} loading={saving}>{t('common.save')}</Button>
        </header>

        <AccountSection />

        <Section title={t('settings.browser')} hint={t('settings.browserHint')}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={t('settings.channel')}>
              <Select value={draft.browserChannel} onChange={(e) => set('browserChannel', e.target.value as Settings['browserChannel'])}>
                <option value="chrome">{t('settings.channel.chrome')}</option>
                <option value="msedge">{t('settings.channel.msedge')}</option>
                <option value="custom">{t('settings.channel.custom')}</option>
              </Select>
            </Field>
            {draft.browserChannel === 'custom' && (
              <Field label={t('settings.browserPath')}>
                <div className="flex gap-2">
                  <Input value={draft.browserPath} onChange={(e) => set('browserPath', e.target.value)} placeholder="C:\\...\\chrome.exe" className="font-mono text-[12px]" />
                  <Button onClick={async () => { const p = await window.api.app.pickFile({ filters: [{ name: 'Executable', extensions: ['exe', 'app', '*'] }] }); if (p) set('browserPath', p) }}>{t('settings.browse')}</Button>
                </div>
              </Field>
            )}
          </div>
          <div className="rounded-[var(--radius-md)] border border-line bg-bg px-3 py-2.5 text-[12.5px]">
            {info?.browserFound ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-fg-muted">{t('settings.detected')}</span>
                <span className="font-mono text-fg">{info.browserPath}</span>
                <span className="font-mono text-fg-faint">v{info.browserVersion || '?'}</span>
              </div>
            ) : (
              <span className="text-warn">{t('settings.notDetected')}</span>
            )}
          </div>
        </Section>

        <Section title={t('settings.general')}>
          <Field label={t('settings.profilesDir')}>
            <div className="flex gap-2">
              <Input value={draft.profilesDir} onChange={(e) => set('profilesDir', e.target.value)} className="font-mono text-[12px]" />
              <Button icon={<FolderOpen size={15} />} onClick={async () => { const p = await window.api.app.pickFile({ directory: true }); if (p) set('profilesDir', p) }}>{t('settings.browse')}</Button>
              <Button variant="ghost" icon={<ArrowSquareOut size={15} />} onClick={() => window.api.app.openPath(settings.profilesDir)}>{t('settings.openFolder')}</Button>
            </div>
          </Field>
          <Field label={t('auth.server')}>
            <Input value={draft.apiBaseUrl} onChange={(e) => set('apiBaseUrl', e.target.value)} className="font-mono text-[12px]" placeholder="https://facetbrowser.com" />
          </Field>
          <Field label={t('settings.defaultStartUrl')}>
            <Input value={draft.defaultStartUrl} onChange={(e) => set('defaultStartUrl', e.target.value)} placeholder="https://" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('settings.language')}>
              <Select value={draft.language} onChange={(e) => set('language', e.target.value as Settings['language'])}>
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
              </Select>
            </Field>
          </div>
        </Section>

        <Section title={t('settings.scoring')} hint={t('settings.scoringHint')}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={t('checker.contact')} hint={t('checker.contactHint')}>
              <Input type="email" value={draft.getipintelContact} onChange={(e) => set('getipintelContact', e.target.value)} placeholder="you@example.com" />
            </Field>
            <Field label={t('checker.abuseKey')} hint="abuseipdb.com/register">
              <Input value={draft.abuseIpDbKey} onChange={(e) => set('abuseIpDbKey', e.target.value)} placeholder={t('common.optional')} className="font-mono text-[12px]" />
            </Field>
            <Field label={t('settings.concurrency')}>
              <Input type="number" min={1} max={20} value={draft.proxyCheckConcurrency} onChange={(e) => set('proxyCheckConcurrency', Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="font-mono" />
            </Field>
            <Field label={t('settings.speedBytes')}>
              <Input type="number" min={50000} step={50000} value={draft.speedTestBytes} onChange={(e) => set('speedTestBytes', Math.max(50000, Number(e.target.value) || 500000))} className="font-mono" />
            </Field>
          </div>
        </Section>

        <Section title={t('settings.about')}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[12.5px]">
            <dt className="text-fg-muted">{t('settings.version')}</dt><dd className="font-mono">{info?.version}</dd>
            <dt className="text-fg-muted">{t('settings.dataDir')}</dt>
            <dd className="font-mono"><button className="hover:underline" onClick={() => info && window.api.app.openPath(info.dataDir)}>{info?.dataDir}</button></dd>
            <dt className="text-fg-muted">Web</dt>
            <dd><button className="hover:underline" onClick={() => window.api.app.openExternal('https://facetbrowser.com')}>facetbrowser.com</button></dd>
          </dl>
        </Section>
      </div>
    </div>
  )
}

function AccountSection(): JSX.Element | null {
  const t = useT()
  const cloud = useApp((s) => s.cloud)
  const setCloud = useApp((s) => s.setCloud)
  const settings = useApp((s) => s.settings)!
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  if (!cloud?.loggedIn || !cloud.user) return null
  const u = cloud.user
  const trialLeft = u.trialEndsAt ? Math.max(0, Math.ceil((u.trialEndsAt - Date.now()) / 86400000)) : 0
  const run = async (key: string, fn: () => Promise<unknown>, okMsg?: string): Promise<void> => {
    setBusy(key)
    try {
      const r = await fn()
      if (r && typeof r === 'object' && 'loggedIn' in (r as object)) setCloud(r as typeof cloud)
      if (okMsg) toast.ok(okMsg)
    } catch (e) {
      toast.err(String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(null)
    }
  }
  const webUrl = `${settings.apiBaseUrl.replace(/\/$/, '')}/account`
  return (
    <Section title={t('account.title')}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[12.5px]">
        <dt className="text-fg-muted">{t('auth.email')}</dt><dd className="font-mono">{u.email}</dd>
        <dt className="text-fg-muted">{t('account.plan')}</dt>
        <dd>{t(`account.plan.${u.plan}` as Key)}{u.plan === 'trial' ? ` · ${u.planActive ? t('account.trialLeft', { n: trialLeft }) : t('account.trialEnded')}` : ''}</dd>
        <dt className="text-fg-muted">{t('account.profiles')}</dt><dd className="font-mono">{u.profileLimit === null ? t('account.unlimited') : u.profileLimit}</dd>
        <dt className="text-fg-muted">{t('account.sync')}</dt>
        <dd>{cloud.syncing ? t('account.syncing') : !cloud.online ? t('account.offline') : cloud.lastSyncAt ? t('account.synced', { t: timeAgo(cloud.lastSyncAt) }) : '-'}{cloud.lastError && <span className="ml-2 text-warn">{t(`account.syncErr.${cloud.lastError}` as Key)}</span>}</dd>
      </dl>
      {!u.emailVerified && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-warn/30 bg-warn/8 px-3 py-2 text-[12.5px] text-warn">
          {t('account.verify')}
          <Button size="sm" loading={busy === 'resend'} onClick={() => run('resend', () => window.api.cloud.resendVerification(), t('account.resent'))}>{t('account.resend')}</Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button loading={busy === 'me'} onClick={() => run('me', () => window.api.cloud.me())}>{t('account.refresh')}</Button>
        <Button loading={busy === 'sync'} onClick={() => run('sync', () => window.api.cloud.syncNow())}>{t('account.syncNow')}</Button>
        <Button onClick={() => window.api.app.openExternal(webUrl)}>{u.plan === 'unlimited' ? t('account.manage') : t('account.upgrade')}</Button>
        <Button variant="danger" onClick={() => setConfirm(true)}>{t('account.signOut')}</Button>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('account.signOut')}
        footer={<><Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button><Button variant="danger" onClick={() => { setConfirm(false); run('out', () => window.api.cloud.logout()) }}>{t('account.signOut')}</Button></>}>
        <p className="text-[13px] text-fg-muted">{t('account.signOutConfirm')}</p>
      </Modal>
    </Section>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6">
      <div>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {hint && <p className="mt-1 max-w-[70ch] text-[12.5px] leading-relaxed text-fg-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}
