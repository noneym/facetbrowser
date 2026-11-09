import { useEffect, useState } from 'react'
import { FolderOpen, ArrowSquareOut, Copy, ArrowsClockwise } from '@phosphor-icons/react'
import type { Settings } from '@shared/types'
import type { AutomationStatus } from '@shared/automation'
import { useApp } from '@/store/app'
import { useT } from '@/lib/i18n'
import { toast } from '@/store/toast'
import { Button, Field, Input, Select, Modal, Toggle, cx } from '@/components/ui'
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

        <EngineSection />

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
          <Toggle checked={draft.restoreTabs !== false} onChange={(v) => set('restoreTabs', v)} label={t('settings.restoreTabs')} hint={t('settings.restoreTabsHint')} />
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

        <AutomationSection draft={draft} set={set} />

        <Section title={t('settings.about')}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[12.5px]">
            <dt className="text-fg-muted">{t('settings.version')}</dt><dd className="font-mono">{info?.version}</dd>
            <dt className="text-fg-muted">{t('settings.dataDir')}</dt>
            <dd className="font-mono"><button className="hover:underline" onClick={() => info && window.api.app.openPath(info.dataDir)}>{info?.dataDir}</button></dd>
            <dt className="text-fg-muted">Web</dt>
            <dd><button className="hover:underline" onClick={() => window.api.app.openExternal('https://facetbrowser.com')}>facetbrowser.com</button></dd>
          </dl>
          <UpdateSection />
        </Section>
      </div>
    </div>
  )
}

// Local REST/WS API for AI agents (docs/automation.md). The draft is saved
// with the page's Save button; the main process restarts the server when the
// saved settings change.
function AutomationSection({ draft, set }: { draft: Settings; set: <K extends keyof Settings>(k: K, v: Settings[K]) => void }): JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<AutomationStatus | null>(null)
  const saved = useApp((s) => s.settings)!
  useEffect(() => {
    window.api.automation.status().then(setStatus).catch(() => {})
    return window.api.automation.onStatus(setStatus)
  }, [])
  const a = draft.automation
  const patch = (p: Partial<Settings['automation']>): void => set('automation', { ...a, ...p })
  const dirty = JSON.stringify(a) !== JSON.stringify(saved.automation)
  const copy = async (text: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
    toast.ok(t('common.copied'))
  }
  const regenerate = (): void => {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    patch({ token: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') })
  }
  const curl = status?.running ? `curl -H "Authorization: Bearer ${saved.automation.token}" http://127.0.0.1:${status.port}/v1/profiles` : ''
  return (
    <Section title={t('settings.automation')} hint={t('settings.automationHint')}>
      <Toggle checked={a.enabled} onChange={(v) => patch({ enabled: v })} label={t('settings.automationEnable')} hint={t('settings.automationEnableHint')} />
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-line bg-bg px-3 py-2.5 text-[12.5px]">
        <span className={cx('h-1.5 w-1.5 rounded-full', status?.running ? 'bg-ok live-dot' : 'bg-line-strong')} />
        <span className={status?.error ? 'text-bad' : status?.running ? 'text-fg' : 'text-fg-muted'}>
          {status?.error ? status.error : status?.running ? t('settings.automationRunning', { port: String(status.port) }) : t('settings.automationStopped')}
        </span>
        {dirty && <span className="text-fg-faint">· {t('settings.automationPending')}</span>}
        {curl && <Button size="sm" variant="ghost" className="ml-auto" icon={<Copy size={13} />} onClick={() => copy(curl)}>curl</Button>}
      </div>
      <div className="grid grid-cols-[140px_1fr] gap-4">
        <Field label={t('settings.automationPort')} hint={t('settings.automationPortHint')}>
          <Input type="number" min={0} max={65535} value={a.port} onChange={(e) => patch({ port: Math.max(0, Math.min(65535, Number(e.target.value) || 0)) })} className="font-mono" />
        </Field>
        <Field label={t('settings.automationToken')} hint={t('settings.automationTokenHint')}>
          <div className="flex gap-2">
            <Input value={a.token} readOnly className="font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
            <Button icon={<Copy size={15} />} onClick={() => copy(a.token)}>{t('common.copy')}</Button>
            <Button variant="ghost" icon={<ArrowsClockwise size={15} />} onClick={regenerate}>{t('settings.automationNewToken')}</Button>
          </div>
        </Field>
      </div>
      <Toggle checked={a.exposeCdp} onChange={(v) => patch({ exposeCdp: v })} label={t('settings.automationExposeCdp')} hint={t('settings.automationExposeCdpHint')} />
      <Toggle checked={!!a.remote} onChange={(v) => patch({ remote: v })} label={t('settings.automationRemote')} hint={t('settings.automationRemoteHint')} />
      {saved.automation.remote && saved.automation.enabled && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-line bg-bg px-3 py-2.5 text-[12.5px]">
          <span className={cx('h-1.5 w-1.5 rounded-full', status?.remote ? 'bg-ok live-dot' : status?.remoteError ? 'bg-bad' : 'bg-line-strong')} />
          <span className={status?.remote ? 'text-fg' : status?.remoteError ? 'text-bad' : 'text-fg-muted'}>
            {status?.remote
              ? t('settings.automationRemoteOn', { id: status.remoteDeviceId || '' })
              : status?.remoteError === 'not_logged_in'
                ? t('settings.automationRemoteLogin')
                : status?.remoteError
                  ? t('settings.automationRemoteError', { error: status.remoteError })
                  : t('settings.automationRemoteConnecting')}
          </span>
          <button className="ml-auto text-fg-muted hover:underline" onClick={() => window.api.app.openExternal(`${saved.apiBaseUrl || 'https://facetbrowser.com'}/account`)}>{t('settings.automationRemoteTokens')}</button>
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[12.5px]">
        <dt className="text-fg-muted">{t('settings.automationDiscovery')}</dt>
        <dd className="font-mono"><button className="hover:underline" onClick={() => status && window.api.app.openPath(status.discoveryFile.replace(/[\\/][^\\/]+$/, ''))}>{status?.discoveryFile}</button></dd>
      </dl>
      <p className="text-[12px] text-fg-faint">{t('settings.automationDocs')}</p>
    </Section>
  )
}

function UpdateSection(): JSX.Element {
  const t = useT()
  const update = useApp((s) => s.update)
  const setUpdate = useApp((s) => s.setUpdate)
  const [busy, setBusy] = useState(false)
  const st = update?.state || 'idle'
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      const r = await fn()
      if (r && typeof r === 'object' && 'state' in r) setUpdate(r as NonNullable<typeof update>)
    } finally {
      setBusy(false)
    }
  }
  const label =
    st === 'checking' ? t('update.checking')
    : st === 'none' ? t('update.none')
    : st === 'available' ? t('update.available', { v: update?.version || '' })
    : st === 'downloading' ? t('update.downloading', { p: String(update?.progress ?? 0) })
    : st === 'ready' ? t('update.ready', { v: update?.version || '' })
    : st === 'error' ? (update?.error === 'not_found' ? t('update.errNotFound') : update?.error === 'offline' ? t('update.errOffline') : update?.error === 'checksum' ? t('update.errChecksum') : t('update.error', { e: update?.error || '' }))
    : st === 'unsupported' ? t('update.unsupported')
    : t('update.idle')
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[12.5px] font-medium">{t('update.title')}</span>
          <span className={'text-[12px] ' + (st === 'error' ? 'text-danger' : st === 'ready' || st === 'available' ? 'text-accent' : 'text-fg-muted')}>{label}</span>
        </div>
        {st === 'unsupported' ? (
          <Button onClick={() => window.api.app.openExternal('https://facetbrowser.com/download')}>{t('update.downloadPage')}</Button>
        ) : st === 'ready' ? (
          <Button variant="primary" onClick={() => window.api.update.install()}>{t('update.install')}</Button>
        ) : st === 'available' ? (
          <Button variant="primary" loading={busy} onClick={() => run(() => window.api.update.download())}>{t('update.download')}</Button>
        ) : (
          <Button loading={busy || st === 'checking'} disabled={st === 'downloading'} onClick={() => run(() => window.api.update.check())}>{st === 'error' ? t('update.retry') : t('update.check')}</Button>
        )}
      </div>
      {st === 'downloading' && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-line"><div className="h-full bg-accent transition-[width]" style={{ width: `${update?.progress || 0}%` }} /></div>
      )}
    </div>
  )
}

function EngineSection(): JSX.Element {
  const t = useT()
  const engine = useApp((s) => s.engine)
  const setEngine = useApp((s) => s.setEngine)
  const [busy, setBusy] = useState(false)
  const install = async (): Promise<void> => {
    setBusy(true)
    try {
      setEngine(await window.api.engine.install())
      toast.ok(t('engine.done'))
    } catch (e) {
      toast.err(String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  const updateAvailable = !!(engine?.installed && engine.latest && engine.latest.version !== engine.installedVersion)
  return (
    <Section title={t('engine.title')} hint={t('engine.hint')}>
      {!engine?.supported && <p className="text-[12.5px] text-warn">{t('engine.unsupported')}</p>}
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-line bg-bg px-3 py-2.5 text-[12.5px]">
        {engine?.installed ? (
          <span>{t('engine.installed')}: <span className="font-mono text-fg">{engine.installedVersion}</span>{updateAvailable && <span className="ml-2 text-accent">{t('engine.updateTo', { v: engine.latest!.version })}</span>}</span>
        ) : (
          <span className="text-fg-muted">{t('engine.notInstalled')}</span>
        )}
        {engine?.downloading && (
          <span className="flex items-center gap-2 text-fg-muted">
            <span className="inline-block h-1 w-32 overflow-hidden rounded-full bg-line"><span className="block h-full bg-accent" style={{ width: `${Math.round((engine.progress || 0) * 100)}%` }} /></span>
            {t('engine.installing')} {Math.round((engine.progress || 0) * 100)}%
          </span>
        )}
        {engine?.error && <span className="text-bad">{engine.error}</span>}
        <span className="ml-auto flex gap-2">
          {engine?.supported && !engine.downloading && (!engine.installed || updateAvailable) && (
            <Button size="sm" variant="primary" loading={busy} onClick={install}>{updateAvailable ? t('engine.update') : t('engine.install')}</Button>
          )}
          {engine?.installed && !engine.downloading && <Button size="sm" variant="ghost" loading={busy} onClick={install}>{t('engine.reinstall')}</Button>}
        </span>
      </div>
    </Section>
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
