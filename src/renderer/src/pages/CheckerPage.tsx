import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Stop, Export, Broom, Pulse, PlusCircle } from '@phosphor-icons/react'
import type { BatchItemEvent, ProxyCheckResult } from '@shared/types'
import { useApp } from '@/store/app'
import { useT, type Key } from '@/lib/i18n'
import { toast, errMsg } from '@/store/toast'
import { latencyColor, kbps, toCsv } from '@/lib/format'
import { Button, Field, Input, Textarea, Toggle, EmptyState, Spinner, cx } from '@/components/ui'
import { GradeBadge } from '@/components/GradeBadge'

interface Row {
  index: number
  raw: string
  stage: BatchItemEvent['stage']
  result?: ProxyCheckResult
}
type Filter = 'all' | 'usable' | 'bad'

export function CheckerPage(): JSX.Element {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const saveSettings = useApp((s) => s.saveSettings)
  const setProxies = useApp((s) => s.setProxies)

  const [text, setText] = useState(() => localStorage.getItem('checker.text') || '')
  const [contact, setContact] = useState(settings.getipintelContact)
  const [abuseKey, setAbuseKey] = useState(settings.abuseIpDbKey)
  const [skipReported, setSkipReported] = useState(true)
  const [speedTest, setSpeedTest] = useState(false)
  const [concurrency, setConcurrency] = useState(settings.proxyCheckConcurrency)
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const unsub = useRef<(() => void) | null>(null)

  useEffect(() => { localStorage.setItem('checker.text', text) }, [text])
  useEffect(() => () => unsub.current?.(), [])

  const lines = useMemo(() => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')), [text])
  const done = rows.filter((r) => r.stage === 'done' || r.stage === 'failed').length
  const bucketOf = (r: Row): Filter | 'pending' => {
    if (!r.result) return 'pending'
    if (!r.result.ok) return 'bad'
    return (r.result.quality ?? 0) >= 50 ? 'usable' : 'bad'
  }
  const counts = useMemo(() => {
    const c = { all: rows.length, usable: 0, bad: 0, dead: 0 }
    for (const r of rows) {
      const b = bucketOf(r)
      if (b === 'usable') c.usable++
      else if (b === 'bad') { c.bad++; if (r.result && !r.result.ok) c.dead++ }
    }
    return c
  }, [rows])
  const visible = rows.filter((r) => filter === 'all' || bucketOf(r) === filter)

  const run = async (): Promise<void> => {
    if (!lines.length) return
    if (contact !== settings.getipintelContact || abuseKey !== settings.abuseIpDbKey || concurrency !== settings.proxyCheckConcurrency) {
      saveSettings({ getipintelContact: contact, abuseIpDbKey: abuseKey, proxyCheckConcurrency: concurrency })
    }
    setRows(lines.map((raw, index) => ({ index, raw, stage: 'queued' })))
    setRunning(true)
    unsub.current?.()
    unsub.current = window.api.checker.onEvent((ev) => {
      setRows((rs) => rs.map((r) => (r.index === ev.index ? { ...r, stage: ev.stage, result: ev.result ?? r.result } : r)))
    })
    try {
      await window.api.checker.run(lines, { contact, abuseKey, skipReported, speedTest, concurrency })
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setRunning(false)
      unsub.current?.()
      unsub.current = null
    }
  }
  const abort = (): void => { window.api.checker.abort() }
  const clear = (): void => { setRows([]); setFilter('all') }

  const exportCsv = async (): Promise<void> => {
    const data = rows.map((r) => ({
      proxy: r.raw,
      status: r.result ? (r.result.ok ? 'ok' : 'dead') : r.stage,
      verdict: r.result?.verdict || '',
      quality: r.result?.quality ?? '',
      grade: r.result?.grade || '',
      ip: r.result?.ip || '',
      latency_ms: r.result?.latencyMs ?? '',
      jitter_ms: r.result?.jitterMs ?? '',
      download_kbps: r.result?.downloadKbps ?? '',
      anonymity: r.result?.anonymity || '',
      country: r.result?.countryCode || '',
      city: r.result?.city || '',
      isp: r.result?.isp || '',
      asn: r.result?.asn || '',
      timezone: r.result?.timezone || '',
      is_proxy: r.result?.isProxy ?? '',
      is_hosting: r.result?.isHosting ?? '',
      is_mobile: r.result?.isMobile ?? '',
      is_tor: r.result?.abuseIsTor ?? '',
      abuse_score: r.result?.abuseScore ?? '',
      abuse_reports: r.result?.abuseReports ?? '',
      abuse_last_reported: r.result?.abuseLastReportedAt || '',
      residential_pct: r.result?.residentialScore ?? '',
      combined_pct: r.result?.combinedScore ?? '',
      issues: r.result?.issues?.join('; ') || '',
      error: r.result?.error || ''
    }))
    const path = await window.api.app.saveText({ defaultPath: `proxy-check-${new Date().toISOString().slice(0, 10)}.csv`, content: toCsv(data), filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (path) toast.ok(t('checker.saved', { path }))
  }
  const addGood = async (): Promise<void> => {
    const good = rows.filter((r) => bucketOf(r) === 'usable').map((r) => r.raw)
    if (!good.length) return
    const { added, proxies } = await window.api.proxies.importText(good.join('\n'), ['checked'])
    setProxies(proxies)
    toast.ok(t('proxies.added', { n: added }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="px-6 pb-3">
        <h1 className="text-[20px] font-semibold tracking-tight">{t('checker.title')}</h1>
        <p className="mt-1 max-w-[70ch] text-[12.5px] text-fg-muted">{t('checker.subtitle')}</p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[360px_1fr]">
        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-t border-line px-6 py-4 lg:border-r">
          <Field label={t('checker.contact')} hint={t('checker.contactHint')}>
            <Input type="email" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label={t('checker.abuseKey')}>
            <Input value={abuseKey} onChange={(e) => setAbuseKey(e.target.value)} placeholder={t('common.optional')} className="font-mono text-[12px]" />
          </Field>
          <Toggle checked={skipReported} onChange={setSkipReported} label={t('checker.skipReported')} />
          <Toggle checked={speedTest} onChange={setSpeedTest} label={t('checker.speedTest')} />
          <Field label={t('checker.concurrency')} className="w-28">
            <Input type="number" min={1} max={20} value={concurrency} onChange={(e) => setConcurrency(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="font-mono" />
          </Field>
          <Field label={`${t('proxies.col.proxy')} (${t('checker.lines', { n: lines.length })})`}>
            <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={'socks5://user:pass@host:port\nhttp://host:port'} className="min-h-40" />
          </Field>
          <div className="flex flex-wrap gap-2">
            {running ? (
              <Button variant="danger" icon={<Stop size={14} weight="fill" />} onClick={abort}>{t('checker.abort')}</Button>
            ) : (
              <Button variant="primary" icon={<Play size={14} weight="fill" />} disabled={!lines.length} onClick={run}>{t('checker.run')}</Button>
            )}
            <Button variant="ghost" icon={<Broom size={14} />} disabled={running || !rows.length} onClick={clear}>{t('checker.clear')}</Button>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col border-t border-line">
          <div className="flex items-center gap-2 border-b border-line px-5 py-2.5">
            {(['all', 'usable', 'bad'] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cx('focus-ring inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-[12.5px] transition-colors', filter === f ? 'border-line-strong bg-surface-3 text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg')}>
                {f === 'all' ? t('common.all') : f === 'usable' ? t('proxies.filter.good') : t('proxies.filter.bad')} <span className="font-mono text-[11px] text-fg-faint">{counts[f]}</span>
              </button>
            ))}
            {rows.length > 0 && (
              <div className="ml-3 flex items-center gap-2 text-[12px] text-fg-muted">
                {running && <Spinner className="h-3 w-3" />}
                <span className="font-mono">{t('checker.progress', { done, total: rows.length })}</span>
                {!running && <span>· {t('checker.summary', { ok: counts.usable, bad: counts.bad - counts.dead, dead: counts.dead })}</span>}
              </div>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="ghost" icon={<PlusCircle size={13} />} disabled={!counts.usable || running} onClick={addGood}>{t('checker.addGood')}</Button>
              <Button size="sm" variant="ghost" icon={<Export size={13} />} disabled={!rows.length} onClick={exportCsv}>{t('checker.exportCsv')}</Button>
            </div>
          </div>
          {rows.length > 0 && (
            <div className="h-0.5 w-full bg-line"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${(done / rows.length) * 100}%` }} /></div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {rows.length === 0 ? (
              <EmptyState icon={<Pulse size={24} />} title={t('checker.empty')} body="" />
            ) : (
              <table className="w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 z-10 bg-bg text-left text-[11.5px] uppercase tracking-wide text-fg-faint">
                  <tr className="border-b border-line">
                    <th className="w-10 py-2 pl-5 pr-2 font-medium">#</th>
                    <th className="py-2 pr-4 font-medium">{t('proxies.col.proxy')}</th>
                    <th className="py-2 pr-4 font-medium">{t('proxies.col.exit')}</th>
                    <th className="py-2 pr-4 font-medium">{t('proxies.col.location')}</th>
                    <th className="py-2 pr-4 font-medium">{t('proxies.col.latency')}</th>
                    <th className="py-2 pr-4 font-medium">{t('proxies.col.anon')}</th>
                    <th className="py-2 pr-4 font-medium">{t('proxies.col.quality')}</th>
                    <th className="py-2 pr-5 font-medium">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const res = r.result
                    return (
                      <tr key={r.index} className="border-b border-line/70 hover:bg-surface">
                        <td className="py-1.5 pl-5 pr-2 font-mono text-fg-faint">{r.index + 1}</td>
                        <td className="max-w-64 truncate py-1.5 pr-4 font-mono text-[12px]" title={r.raw}>{r.raw.replace(/:\/\/[^@]+@/, '://***@')}</td>
                        <td className="py-1.5 pr-4 font-mono text-[12px]">{res?.ip || <span className="text-fg-faint">-</span>}</td>
                        <td className="py-1.5 pr-4">{res?.countryCode ? <><span className="font-mono">{res.countryCode}</span> <span className="text-fg-muted">{res.city}</span><div className="truncate text-[11px] text-fg-faint">{res.isp}</div></> : <span className="text-fg-faint">-</span>}</td>
                        <td className="py-1.5 pr-4 font-mono text-[12px]">{res?.latencyMs !== undefined ? <><span style={{ color: latencyColor(res.latencyMs) }}>{res.latencyMs} ms</span>{res.downloadKbps !== undefined && <div className="text-[11px] text-fg-faint">{kbps(res.downloadKbps)}</div>}</> : <span className="text-fg-faint">-</span>}</td>
                        <td className="py-1.5 pr-4">{res?.anonymity ? t(`anon.${res.anonymity}` as Key) : <span className="text-fg-faint">-</span>}</td>
                        <td className="py-1.5 pr-4"><GradeBadge result={res} compact /> {res?.issues && res.issues.length > 0 && <span className="ml-1 text-[11.5px] text-fg-muted" title={res.issues.join('\n')}>{res.issues[0]}{res.issues.length > 1 ? ` +${res.issues.length - 1}` : ''}</span>}</td>
                        <td className="py-1.5 pr-5">
                          <span className="inline-flex items-center gap-1.5" style={{ color: r.stage === 'done' ? 'var(--color-ok)' : r.stage === 'failed' ? 'var(--color-bad)' : 'var(--color-fg-muted)' }}>
                            {(r.stage === 'connecting' || r.stage === 'enriching' || r.stage === 'scoring') && <Spinner className="h-3 w-3" />}
                            {t(`checker.stage.${r.stage}` as Key)}
                          </span>
                          {res?.error && <div className="max-w-56 truncate text-[11px] text-fg-faint" title={res.error}>{res.error}</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
