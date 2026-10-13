import { useMemo, useState } from 'react'
import { Plus, Globe, ArrowsClockwise, Trash, Copy, CaretRight, MagnifyingGlass } from '@phosphor-icons/react'
import type { ProxyCheckResult, SavedProxy } from '@shared/types'
import { useApp } from '@/store/app'
import { useT, type Key } from '@/lib/i18n'
import { toast, errMsg } from '@/store/toast'
import { timeAgo, proxyLine, proxyShort, latencyColor, kbps, proxyBucket } from '@/lib/format'
import { Button, Checkbox, EmptyState, IconButton, Input, Modal, Textarea, TagInput, Toggle, Badge, Spinner, cx } from '@/components/ui'
import { GradeBadge, QualityBar } from '@/components/GradeBadge'
import { ProvidersDialog } from '@/components/Providers'
import { Plugs } from '@phosphor-icons/react'

type Bucket = 'all' | 'good' | 'bad' | 'unchecked'

export function ProxiesPage(): JSX.Element {
  const t = useT()
  const proxies = useApp((s) => s.proxies)
  const profiles = useApp((s) => s.profiles)
  const checking = useApp((s) => s.checking)
  const setProxies = useApp((s) => s.setProxies)
  const settings = useApp((s) => s.settings)!

  const [q, setQ] = useState('')
  const [bucket, setBucket] = useState<Bucket>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [provOpen, setProvOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const [speedTest, setSpeedTest] = useState(true)
  const [runningCheck, setRunningCheck] = useState(false)

  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of profiles) if (p.proxy.mode === 'saved' && p.proxy.savedId) m.set(p.proxy.savedId, (m.get(p.proxy.savedId) || 0) + 1)
    return m
  }, [profiles])

  const counts = useMemo(() => {
    const c = { all: proxies.length, good: 0, bad: 0, unchecked: 0 }
    for (const p of proxies) c[proxyBucket(p)]++
    return c
  }, [proxies])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return proxies.filter((p) => {
      if (bucket !== 'all' && proxyBucket(p) !== bucket) return false
      if (!needle) return true
      return [p.name, p.host, p.username, p.tags.join(' '), p.lastCheck?.ip, p.lastCheck?.country, p.lastCheck?.isp].join(' ').toLowerCase().includes(needle)
    })
  }, [proxies, q, bucket])

  const allSel = visible.length > 0 && visible.every((p) => selected.has(p.id))
  const toggleAll = (): void => setSelected(allSel ? new Set() : new Set(visible.map((p) => p.id)))
  const toggle = (id: string, v: boolean): void => setSelected((s) => { const n = new Set(s); v ? n.add(id) : n.delete(id); return n })

  const check = async (ids: string[]): Promise<void> => {
    if (!ids.length) return
    setRunningCheck(true)
    try {
      const list = await window.api.proxies.check(ids, { speedTest })
      setProxies(list)
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setRunningCheck(false)
    }
  }
  const del = async (): Promise<void> => {
    if (!deleteIds) return
    setProxies(await window.api.proxies.delete(deleteIds))
    setSelected(new Set())
    setDeleteIds(null)
  }
  const copy = (p: SavedProxy): void => {
    navigator.clipboard.writeText(proxyLine(p))
    toast.ok(t('common.copied'))
  }
  const noScorer = !settings.getipintelContact && !settings.abuseIpDbKey

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 px-6 pb-3">
        <h1 className="mr-2 text-[20px] font-semibold tracking-tight">{t('proxies.title')}</h1>
        <span className="font-mono text-[12px] text-fg-faint">{t('proxies.count', { n: proxies.length })}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} className="w-56 pl-8" />
          </div>
          <Button icon={<Plugs size={15} />} onClick={() => setProvOpen(true)}>{t('prov.title')}</Button>
          <Button icon={runningCheck ? <Spinner /> : <ArrowsClockwise size={15} />} disabled={runningCheck || proxies.length === 0} onClick={() => check(proxies.map((p) => p.id))}>{t('proxies.checkAll')}</Button>
          <Button variant="primary" icon={<Plus size={15} weight="bold" />} onClick={() => setAddOpen(true)}>{t('proxies.add')}</Button>
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-line px-6 pb-3">
        {(['all', 'good', 'bad', 'unchecked'] as Bucket[]).map((b) => (
          <button key={b} onClick={() => setBucket(b)} className={cx('focus-ring inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-[12.5px] transition-colors', bucket === b ? 'border-line-strong bg-surface-3 text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg')}>
            {t(`proxies.filter.${b}` as Key)} <span className="font-mono text-[11px] text-fg-faint">{counts[b]}</span>
          </button>
        ))}
        <div className="ml-2 w-56">
          <Toggle checked={speedTest} onChange={setSpeedTest} label={t('proxies.speedTest')} />
        </div>
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-1.5 rounded-[var(--radius-md)] border border-line bg-surface-2 py-1 pl-3 pr-1 text-[12.5px]">
            <span className="font-mono">{selected.size}</span> {t('common.selected')}
            <span className="mx-1 h-4 w-px bg-line" />
            <Button size="sm" variant="ghost" icon={<ArrowsClockwise size={13} />} disabled={runningCheck} onClick={() => check([...selected])}>{t('common.check')}</Button>
            <Button size="sm" variant="ghost" className="text-bad hover:text-bad" icon={<Trash size={13} />} onClick={() => setDeleteIds([...selected])}>{t('common.delete')}</Button>
          </div>
        )}
      </div>

      {noScorer && proxies.length > 0 && (
        <div className="mx-6 mt-3 rounded-[var(--radius-md)] border border-warn/30 bg-warn/8 px-3 py-2 text-[12.5px] text-warn">{t('detail.noScorer')}</div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {proxies.length === 0 ? (
          <EmptyState icon={<Globe size={24} />} title={t('proxies.empty.title')} body={t('proxies.empty.body')} action={<Button variant="primary" icon={<Plus size={15} weight="bold" />} onClick={() => setAddOpen(true)}>{t('proxies.add')}</Button>} />
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-bg text-left text-[11.5px] uppercase tracking-wide text-fg-faint">
              <tr className="border-b border-line">
                <th className="w-10 px-4 py-2"><Checkbox checked={allSel} indeterminate={!allSel && selected.size > 0} onChange={toggleAll} ariaLabel="select all" /></th>
                <th className="py-2 pr-4 font-medium">{t('proxies.col.proxy')}</th>
                <th className="py-2 pr-4 font-medium">{t('proxies.col.exit')}</th>
                <th className="py-2 pr-4 font-medium">{t('proxies.col.location')}</th>
                <th className="py-2 pr-4 font-medium">{t('proxies.col.latency')}</th>
                <th className="py-2 pr-4 font-medium">{t('proxies.col.anon')}</th>
                <th className="py-2 pr-4 font-medium">{t('proxies.col.quality')}</th>
                <th className="py-2 pr-4 font-medium">{t('proxies.col.checked')}</th>
                <th className="w-28 py-2 pr-4 text-right font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const r = p.lastCheck
                const stage = checking[p.id]
                const open = expanded === p.id
                return (
                  <ProxyRow key={p.id} p={p} r={r} stage={stage} open={open} selected={selected.has(p.id)} usedBy={usage.get(p.id) || 0}
                    onToggle={(v) => toggle(p.id, v)} onExpand={() => setExpanded(open ? null : p.id)} onCheck={() => check([p.id])} onCopy={() => copy(p)} onDelete={() => setDeleteIds([p.id])} />
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <AddProxiesDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <ProvidersDialog open={provOpen} onClose={() => setProvOpen(false)} />

      <Modal open={!!deleteIds} onClose={() => setDeleteIds(null)} title={t('common.delete')}
        footer={<><Button onClick={() => setDeleteIds(null)}>{t('common.cancel')}</Button><Button variant="danger" onClick={del}>{t('common.delete')}</Button></>}>
        <p className="text-[13px] leading-relaxed text-fg-muted">{t('proxies.deleteConfirm', { n: deleteIds?.length || 0 })}</p>
      </Modal>
    </div>
  )
}

function ProxyRow({ p, r, stage, open, selected, usedBy, onToggle, onExpand, onCheck, onCopy, onDelete }: {
  p: SavedProxy; r?: ProxyCheckResult; stage?: string; open: boolean; selected: boolean; usedBy: number
  onToggle: (v: boolean) => void; onExpand: () => void; onCheck: () => void; onCopy: () => void; onDelete: () => void
}): JSX.Element {
  const t = useT()
  return (
    <>
      <tr onClick={onExpand} className={cx('cursor-pointer border-b border-line/70 transition-colors hover:bg-surface', (selected || open) && 'bg-surface')}>
        <td className="px-4 py-2"><Checkbox checked={selected} onChange={onToggle} ariaLabel={p.host} /></td>
        <td className="py-2 pr-4">
          <div className="flex items-center gap-2">
            <CaretRight size={12} className={cx('shrink-0 text-fg-faint transition-transform', open && 'rotate-90')} />
            <div className="min-w-0">
              <div className="truncate font-mono text-[12.5px]">{p.name || proxyShort(p)}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-fg-faint">
                <span className="uppercase">{p.protocol}</span>
                {p.username && <span>· auth</span>}
                {usedBy > 0 && <span>· {t('proxies.usedBy', { n: usedBy })}</span>}
                {p.tags.map((x) => <Badge key={x}>{x}</Badge>)}
              </div>
            </div>
          </div>
        </td>
        <td className="py-2 pr-4 font-mono text-[12.5px]">
          {stage ? <span className="flex items-center gap-1.5 font-sans text-fg-muted"><Spinner className="h-3 w-3" /> {t(`checker.stage.${stage}` as Key)}</span> : r?.ip || <span className="text-fg-faint">-</span>}
        </td>
        <td className="py-2 pr-4">
          {r?.countryCode ? (
            <div><span className="font-mono text-[12px]">{r.countryCode}</span> <span className="text-fg-muted">{r.city || r.country}</span><div className="truncate text-[11px] text-fg-faint" title={r.isp}>{r.isp}</div></div>
          ) : <span className="text-fg-faint">-</span>}
        </td>
        <td className="py-2 pr-4 font-mono text-[12.5px]">
          {r?.latencyMs !== undefined ? (
            <div><span style={{ color: latencyColor(r.latencyMs) }}>{r.latencyMs} ms</span>{r.downloadKbps !== undefined && <div className="text-[11px] text-fg-faint">{kbps(r.downloadKbps)}</div>}</div>
          ) : <span className="text-fg-faint">-</span>}
        </td>
        <td className="py-2 pr-4">
          {r?.anonymity ? (
            <span className="text-[12.5px]" style={{ color: r.anonymity === 'elite' ? 'var(--color-ok)' : r.anonymity === 'anonymous' ? 'var(--color-warn)' : r.anonymity === 'transparent' ? 'var(--color-bad)' : 'var(--color-fg-faint)' }}>
              {t(`anon.${r.anonymity}` as Key)}
            </span>
          ) : <span className="text-fg-faint">-</span>}
        </td>
        <td className="py-2 pr-4"><GradeBadge result={r} /></td>
        <td className="py-2 pr-4 text-[12.5px] text-fg-muted">{r ? timeAgo(r.checkedAt) : t('proxies.notChecked')}</td>
        <td className="py-2 pr-4">
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <IconButton title={t('common.check')} onClick={onCheck} disabled={!!stage}><ArrowsClockwise size={15} /></IconButton>
            <IconButton title={t('proxies.copyLine')} onClick={onCopy}><Copy size={15} /></IconButton>
            <IconButton title={t('common.delete')} onClick={onDelete} className="hover:text-bad"><Trash size={15} /></IconButton>
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-surface">
          <td />
          <td colSpan={8} className="py-3 pr-6">
            <ProxyDetail r={r} />
          </td>
        </tr>
      )}
    </>
  )
}

export function ProxyDetail({ r }: { r?: ProxyCheckResult }): JSX.Element {
  const t = useT()
  if (!r) return <div className="text-[12.5px] text-fg-faint">{t('proxies.notChecked')}</div>
  const flags = [r.isProxy && 'proxy', r.isHosting && 'hosting', r.isMobile && 'mobile', r.abuseIsTor && 'tor'].filter(Boolean) as string[]
  const row = (label: string, value: React.ReactNode): JSX.Element => (
    <div className="flex items-baseline justify-between gap-4 py-1"><span className="text-fg-muted">{label}</span><span className="text-right font-mono text-fg">{value}</span></div>
  )
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-2 text-[12.5px] md:grid-cols-3">
      <div>
        <div className="mb-1 text-[11.5px] uppercase tracking-wide text-fg-faint">{t('detail.signals')}</div>
        {r.quality !== undefined && <div className="mb-2 flex items-center gap-2"><QualityBar value={r.quality} className="w-32" /><span className="font-mono">{r.quality}/100</span></div>}
        {r.issues && r.issues.length > 0 ? (
          <ul className="flex flex-col gap-1">{r.issues.map((i) => <li key={i} className="flex gap-2 text-warn"><span>•</span><span className="text-fg">{i}</span></li>)}</ul>
        ) : <div className="text-ok">{t('detail.noIssues')}</div>}
      </div>
      <div>
        {row(t('detail.jitter'), r.jitterMs !== undefined ? `${r.jitterMs} ms` : '-')}
        {row(t('detail.samples'), r.latencySamples?.join(' / ') || '-')}
        {row(t('detail.timezone'), r.timezone || '-')}
        {row(t('detail.asn'), r.asn || '-')}
        {row(t('detail.flags'), flags.length ? flags.join(', ') : t('common.none'))}
        {r.leakedHeaders && r.leakedHeaders.length > 0 && row(t('detail.leaked'), r.leakedHeaders.join(', '))}
      </div>
      <div>
        {row(t('detail.abuse'), typeof r.abuseScore === 'number' ? `${r.abuseScore}%` : '-')}
        {row(t('detail.reports'), typeof r.abuseReports === 'number' ? `${r.abuseReports}${r.abuseLastReportedAt ? ` (${r.abuseLastReportedAt.slice(0, 10)})` : ''}` : '-')}
        {row(t('detail.residential'), typeof r.residentialScore === 'number' ? `${Math.round(r.residentialScore)}%` : '-')}
        {row(t('detail.combined'), typeof r.combinedScore === 'number' ? `${Math.round(r.combinedScore)}%` : '-')}
        {r.error && row(t('common.error'), <span className="text-bad">{r.error}</span>)}
      </div>
    </div>
  )
}

function AddProxiesDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const t = useT()
  const setProxies = useApp((s) => s.setProxies)
  const [text, setText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length
  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      const { added, proxies } = await window.api.proxies.importText(text, tags)
      setProxies(proxies)
      toast.ok(t('proxies.added', { n: added }))
      setText('')
      onClose()
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={t('proxies.add')} width={560}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!lines} onClick={add}>{t('common.add')} {lines > 0 && <span className="font-mono opacity-70">{lines}</span>}</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="text-[12.5px] text-fg-muted">{t('proxies.paste')}</div>
        <pre className="rounded-[var(--radius-md)] border border-line bg-bg px-3 py-2 font-mono text-[11.5px] leading-relaxed text-fg-faint">{`socks5://user:pass@host:port\nhttp://host:port\nhost:port:user:pass\nuser:pass@host:port`}</pre>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="socks5://user:pass@1.2.3.4:1080" autoFocus />
        <TagInput value={tags} onChange={setTags} placeholder={t('editor.tags.placeholder')} />
      </div>
    </Modal>
  )
}
