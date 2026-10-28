import { useEffect, useState } from 'react'
import { PuzzlePiece, Trash, Check, ArrowSquareOut, ShareNetwork } from '@phosphor-icons/react'
import type { FeaturedExtension, InstalledExtension } from '@shared/types'
import { useApp } from '@/store/app'
import { useT, useI18n } from '@/lib/i18n'
import { toast, friendlyError } from '@/store/toast'
import { Button, Input, Toggle, Modal, Select, Checkbox, cx } from '@/components/ui'

// Web Store extensions: paste an id or store URL, or pick from the curated
// list. Installed ones load in every profile by default; switch that off to
// pick them per profile in the editor instead.
export function ExtensionsPage(): JSX.Element {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const extensions = useApp((s) => s.extensions)
  const setExtensions = useApp((s) => s.setExtensions)
  const [featured, setFeatured] = useState<FeaturedExtension[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [share, setShare] = useState<InstalledExtension | null>(null)

  useEffect(() => {
    window.api.extensions.featured().then(setFeatured).catch(() => {})
  }, [])

  const installed = new Map(extensions.map((e) => [e.id, e]))
  const install = async (value: string): Promise<void> => {
    const key = value.trim()
    if (!key) return
    setBusy(key)
    try {
      setExtensions(await window.api.extensions.install(key))
      setInput('')
      toast.ok(t('ext.installed'))
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }
  const remove = async (id: string): Promise<void> => {
    setBusy(id)
    try {
      setExtensions(await window.api.extensions.remove(id))
    } finally {
      setBusy(null)
    }
  }
  const setAll = async (id: string, on: boolean): Promise<void> => setExtensions(await window.api.extensions.setAll(id, on))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 pb-16 pt-2">
        <header className="flex flex-col gap-1">
          <h1 className="text-[20px] font-semibold tracking-tight">{t('ext.title')}</h1>
          <p className="text-[13px] text-fg-muted">{t('ext.intro')}</p>
        </header>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            install(input)
          }}
        >
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('ext.placeholder')} className="flex-1 font-mono text-[12.5px]" />
          <Button type="submit" variant="primary" loading={busy === input.trim() && !!input.trim()} disabled={!input.trim()}>{t('ext.install')}</Button>
        </form>

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-medium text-fg-muted">{t('ext.featured')}</h2>
          <div className="grid grid-cols-2 gap-3">
            {featured.map((f) => {
              const have = installed.get(f.id)
              return (
                <div key={f.id} className={cx('flex flex-col gap-2 rounded-[var(--radius-lg)] border p-4', f.highlight ? 'border-accent/40 bg-accent/5' : 'border-line bg-surface')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      {have?.icon ? <img src={have.icon} alt="" className="h-7 w-7 rounded" /> : <span className="flex h-7 w-7 items-center justify-center rounded bg-surface-3 text-fg-muted"><PuzzlePiece size={16} /></span>}
                      <div className="flex flex-col">
                        <span className="text-[13.5px] font-medium">{f.name}</span>
                        {f.highlight && <span className="text-[11px] text-accent">{t('ext.recommended')}</span>}
                      </div>
                    </div>
                    {have ? (
                      <span className="flex items-center gap-1 text-[12px] text-accent"><Check size={14} weight="bold" /> {t('ext.installedBadge')}</span>
                    ) : (
                      <Button size="sm" loading={busy === f.id} onClick={() => install(f.id)}>{t('ext.install')}</Button>
                    )}
                  </div>
                  <p className="text-[12.5px] leading-snug text-fg-muted">{f.blurb[lang === 'tr' ? 0 : 1]}</p>
                </div>
              )
            })}
          </div>
          <p className="text-[12px] leading-relaxed text-fg-faint">{t('ext.passwordNote')}</p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-medium text-fg-muted">{t('ext.installedList')} ({extensions.length})</h2>
          {extensions.length === 0 ? (
            <p className="text-[13px] text-fg-faint">{t('ext.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-surface">
              {extensions.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                  {e.icon ? <img src={e.icon} alt="" className="h-8 w-8 rounded" /> : <span className="flex h-8 w-8 items-center justify-center rounded bg-surface-3 text-fg-muted"><PuzzlePiece size={16} /></span>}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13.5px] font-medium">{e.name}</span>
                    <span className="truncate font-mono text-[11px] text-fg-faint">v{e.version} · {e.id}</span>
                  </div>
                  <div className="w-44 shrink-0">
                    <Toggle checked={e.enabledForAll} onChange={(v) => setAll(e.id, v)} label={t('ext.allProfiles')} />
                  </div>
                  <Button size="sm" icon={<ShareNetwork size={14} />} onClick={() => setShare(e)}>{t('ext.share')}</Button>
                  <button className="focus-ring rounded p-1.5 text-fg-faint hover:text-fg" title={t('ext.openStore')} onClick={() => window.api.app.openExternal(`https://chromewebstore.google.com/detail/${e.id}`)}><ArrowSquareOut size={16} /></button>
                  <button className="focus-ring rounded p-1.5 text-fg-faint hover:text-danger" title={t('common.delete')} disabled={busy === e.id} onClick={() => remove(e.id)}><Trash size={16} /></button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[12px] leading-relaxed text-fg-faint">{t('ext.perProfileHint')}</p>
        </section>
      </div>
      {share && <ShareDialog ext={share} onClose={() => setShare(null)} />}
    </div>
  )
}

// Copies one extension's own data (sign-in, settings) from a profile where it
// is set up into other closed profiles.
function ShareDialog({ ext, onClose }: { ext: InstalledExtension; onClose: () => void }): JSX.Element {
  const t = useT()
  const profiles = useApp((s) => s.profiles)
  const running = useApp((s) => s.running)
  const runningIds = new Set(running.map((r) => r.profileId))
  const [withData, setWithData] = useState<string[] | null>(null)
  const [from, setFrom] = useState('')
  const [targets, setTargets] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.extensions.dataProfiles(ext.id).then((ids) => {
      setWithData(ids)
      const byRecent = [...ids].sort((a, b) => (profiles.find((p) => p.id === b)?.lastLaunchedAt || 0) - (profiles.find((p) => p.id === a)?.lastLaunchedAt || 0))
      const src = byRecent[0] || ''
      setFrom(src)
      setTargets(new Set(profiles.filter((p) => p.id !== src && !runningIds.has(p.id)).map((p) => p.id)))
    }).catch(() => setWithData([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext.id])

  const toggle = (id: string, on: boolean): void => setTargets((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n })
  const run = async (): Promise<void> => {
    if (!from || !targets.size) return
    setBusy(true)
    try {
      const r = await window.api.extensions.copyData(ext.id, from, [...targets])
      toast.ok(t('ext.shareDone', { n: String(r.copied.length) }) + (r.skippedRunning.length ? ' ' + t('ext.shareSkipped', { n: String(r.skippedRunning.length) }) : ''))
      onClose()
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`${t('ext.share')}: ${ext.name}`}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!from || !targets.size} onClick={run}>{t('ext.shareRun')}</Button></>}>
      <div className="flex flex-col gap-4 text-[13px]">
        <p className="leading-relaxed text-fg-muted">{t('ext.shareIntro')}</p>
        {withData && withData.length === 0 ? (
          <p className="text-warn">{t('ext.shareNoData')}</p>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-fg-muted">{t('ext.shareFrom')}</span>
              <Select value={from} onChange={(e) => { setFrom(e.target.value); setTargets((prev) => { const n = new Set(prev); n.delete(e.target.value); return n }) }}>
                {(withData || []).map((id) => { const p = profiles.find((x) => x.id === id); return <option key={id} value={id}>{p?.name || id}{runningIds.has(id) ? ` (${t('nav.running')})` : ''}</option> })}
              </Select>
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-fg-muted">{t('ext.shareTo')}</span>
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-[var(--radius-md)] border border-line p-2">
                {profiles.filter((p) => p.id !== from).map((p) => (
                  <li key={p.id} className="flex items-center gap-2.5">
                    <Checkbox checked={targets.has(p.id)} onChange={(v) => toggle(p.id, v)} ariaLabel={p.name} />
                    <span className={runningIds.has(p.id) ? 'text-fg-faint' : ''}>{p.name}</span>
                    {runningIds.has(p.id) && <span className="text-[11px] text-warn">{t('ext.shareRunning')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
