import { useState } from 'react'
import { DownloadSimple, ArrowsClockwise } from '@phosphor-icons/react'
import { useApp } from '@/store/app'
import { useT } from '@/lib/i18n'
import { toast, errMsg } from '@/store/toast'
import { Button } from '@/components/ui'
import { Logo } from '@/components/Logo'

// Shown once after sign-in until the engine is on disk. Nothing else in the
// app works without it, so this is a full-screen step rather than a setting.
export function EngineSetup(): JSX.Element {
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
      toast.err(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  const pct = Math.round((engine?.progress || 0) * 100)
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-[16px] font-semibold tracking-tight">FacetBrowser</span>
        </div>
        <h1 className="text-[20px] font-semibold tracking-tight">{t('setup.title')}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{t('setup.body')}</p>
        <ul className="mt-5 flex flex-col gap-2 text-[13px] text-fg-muted">
          {[t('setup.point1'), t('setup.point2'), t('setup.point3')].map((p) => (
            <li key={p} className="flex gap-2"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{p}</li>
          ))}
        </ul>
        <div className="mt-7 rounded-[var(--radius-md)] border border-line bg-surface p-4">
          {!engine?.supported ? (
            <p className="text-[13px] text-warn">{t('engine.unsupported')}</p>
          ) : engine.downloading || busy ? (
            <div>
              <div className="flex items-center justify-between text-[12.5px] text-fg-muted"><span className="flex items-center gap-2"><ArrowsClockwise size={14} className="animate-spin" /> {t('engine.installing')}</span><span className="font-mono">{pct}%</span></div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} /></div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[12.5px] text-fg-muted">
                <div>{t('setup.version')}: <span className="font-mono text-fg">{engine.latest?.version || '-'}</span></div>
                {engine.error && <div className="mt-1 text-bad">{engine.error}</div>}
              </div>
              <Button variant="primary" icon={<DownloadSimple size={15} />} onClick={install}>{t('engine.install')}</Button>
            </div>
          )}
        </div>
        <p className="mt-4 text-[12px] text-fg-faint">{t('setup.license')}</p>
      </div>
    </div>
  )
}
