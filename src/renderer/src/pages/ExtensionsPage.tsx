import { useEffect, useState } from 'react'
import { PuzzlePiece, Trash, Check, ArrowSquareOut } from '@phosphor-icons/react'
import type { FeaturedExtension } from '@shared/types'
import { useApp } from '@/store/app'
import { useT, useI18n } from '@/lib/i18n'
import { toast, friendlyError } from '@/store/toast'
import { Button, Input, Toggle, cx } from '@/components/ui'

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
                  <button className="focus-ring rounded p-1.5 text-fg-faint hover:text-fg" title={t('ext.openStore')} onClick={() => window.api.app.openExternal(`https://chromewebstore.google.com/detail/${e.id}`)}><ArrowSquareOut size={16} /></button>
                  <button className="focus-ring rounded p-1.5 text-fg-faint hover:text-danger" title={t('common.delete')} disabled={busy === e.id} onClick={() => remove(e.id)}><Trash size={16} /></button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[12px] leading-relaxed text-fg-faint">{t('ext.perProfileHint')}</p>
        </section>
      </div>
    </div>
  )
}
