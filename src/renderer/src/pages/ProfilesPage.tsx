import { useMemo, useState } from 'react'
import { Plus, MagnifyingGlass, Play, Stop, DotsThree, Copy, Trash, Export, DownloadSimple, Star, PencilSimple, UserCircle } from '@phosphor-icons/react'
import type { Profile } from '@shared/types'
import { useApp } from '@/store/app'
import { useT } from '@/lib/i18n'
import { toast, errMsg, friendlyError } from '@/store/toast'
import { timeAgo, osLabel, proxyShort } from '@/lib/format'
import { Button, Checkbox, EmptyState, IconButton, Input, Menu, Modal, Badge, Toggle, Select, cx } from '@/components/ui'
import { GradeBadge } from '@/components/GradeBadge'

type Filter = 'all' | 'running' | 'favorites'

export function ProfilesPage(): JSX.Element {
  const t = useT()
  const profiles = useApp((s) => s.profiles)
  const proxies = useApp((s) => s.proxies)
  const groups = useApp((s) => s.groups)
  const running = useApp((s) => s.running)
  const openEditor = useApp((s) => s.openEditor)
  const setProfiles = useApp((s) => s.setProfiles)
  const refreshProfiles = useApp((s) => s.refreshProfiles)

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [groupId, setGroupId] = useState('')
  const [tag, setTag] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [cloneTarget, setCloneTarget] = useState<Profile | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null)

  const runningMap = useMemo(() => new Map(running.map((r) => [r.profileId, r])), [running])
  const proxyMap = useMemo(() => new Map(proxies.map((p) => [p.id, p])), [proxies])
  const allTags = useMemo(() => [...new Set(profiles.flatMap((p) => p.tags))].sort(), [profiles])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return profiles.filter((p) => {
      if (filter === 'running' && !runningMap.has(p.id)) return false
      if (filter === 'favorites' && !p.favorite) return false
      if (groupId && p.groupId !== groupId) return false
      if (tag && !p.tags.includes(tag)) return false
      if (!needle) return true
      const prox = p.proxy.mode === 'saved' ? proxyMap.get(p.proxy.savedId || '') : p.proxy.custom
      return [p.name, p.notes, p.tags.join(' '), prox?.host || '', p.fingerprint.os].join(' ').toLowerCase().includes(needle)
    })
  }, [profiles, q, filter, groupId, tag, runningMap, proxyMap])

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id))
  const toggleAll = (): void => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((p) => p.id)))
  const toggle = (id: string, v: boolean): void => setSelected((s) => { const n = new Set(s); v ? n.add(id) : n.delete(id); return n })

  const setBusyFor = (id: string, v: boolean): void => setBusy((b) => ({ ...b, [id]: v }))

  const launch = async (p: Profile): Promise<void> => {
    setBusyFor(p.id, true)
    try {
      await window.api.browser.launch(p.id)
      toast.ok(t('profiles.launched', { name: p.name }))
    } catch (e) {
      toast.err(t('profiles.launchFailed', { err: friendlyError(e) }))
    } finally {
      setBusyFor(p.id, false)
    }
  }
  const stop = async (p: Profile): Promise<void> => {
    setBusyFor(p.id, true)
    try {
      await window.api.browser.stop(p.id)
      toast.ok(t('profiles.stopped', { name: p.name }))
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setBusyFor(p.id, false)
    }
  }
  const toggleFavorite = async (p: Profile): Promise<void> => {
    await window.api.profiles.save({ ...p, favorite: !p.favorite })
    refreshProfiles()
  }
  const createNew = async (): Promise<void> => {
    const limit = useApp.getState().cloud?.user?.profileLimit ?? null
    if (limit !== null && profiles.length >= limit) { toast.err(t('gate.profile_limit')); return }
    const p = await window.api.profiles.new()
    openEditor(p, true)
  }
  const doDelete = async (wipe: boolean): Promise<void> => {
    if (!deleteTargets) return
    const list = await window.api.profiles.delete(deleteTargets, wipe)
    setProfiles(list)
    setSelected(new Set())
    setDeleteTargets(null)
  }
  const exportIds = async (ids: string[]): Promise<void> => {
    const path = await window.api.profiles.export(ids)
    if (path) toast.ok(t('profiles.exported', { path }))
  }
  const importProfiles = async (): Promise<void> => {
    try {
      const n = await window.api.profiles.import()
      if (n) { toast.ok(t('profiles.imported', { n })); refreshProfiles() }
    } catch (e) {
      toast.err(errMsg(e))
    }
  }
  const selectedList = profiles.filter((p) => selected.has(p.id))

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 px-6 pb-3">
        <h1 className="mr-2 text-[20px] font-semibold tracking-tight">{t('profiles.title')}</h1>
        <span className="font-mono text-[12px] text-fg-faint">{t('profiles.count', { n: profiles.length })}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} className="w-56 pl-8" />
          </div>
          <Button variant="ghost" icon={<DownloadSimple size={15} />} onClick={importProfiles}>{t('common.import')}</Button>
          <Button variant="primary" icon={<Plus size={15} weight="bold" />} onClick={createNew}>{t('profiles.new')}</Button>
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-line px-6 pb-3">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>{t('common.all')}</FilterChip>
        <FilterChip active={filter === 'running'} onClick={() => setFilter('running')}>{t('profiles.filter.running')} {running.length > 0 && <span className="font-mono text-fg-faint">{running.length}</span>}</FilterChip>
        <FilterChip active={filter === 'favorites'} onClick={() => setFilter('favorites')}>{t('profiles.filter.favorites')}</FilterChip>
        {groups.length > 0 && (
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="h-7 w-40 text-[12.5px]">
            <option value="">{t('profiles.filter.group')}: {t('common.all')}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        )}
        {allTags.length > 0 && (
          <Select value={tag} onChange={(e) => setTag(e.target.value)} className="h-7 w-40 text-[12.5px]">
            <option value="">{t('profiles.filter.tag')}: {t('common.all')}</option>
            {allTags.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
        )}

        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-1.5 rounded-[var(--radius-md)] border border-line bg-surface-2 py-1 pl-3 pr-1 text-[12.5px]">
            <span className="font-mono">{selected.size}</span> {t('common.selected')}
            <span className="mx-1 h-4 w-px bg-line" />
            <Button size="sm" variant="ghost" icon={<Play size={13} weight="fill" />} onClick={() => selectedList.filter((p) => !runningMap.has(p.id)).forEach(launch)}>{t('common.launch')}</Button>
            <Button size="sm" variant="ghost" icon={<Stop size={13} weight="fill" />} onClick={() => selectedList.filter((p) => runningMap.has(p.id)).forEach(stop)}>{t('common.stop')}</Button>
            <Button size="sm" variant="ghost" icon={<Export size={13} />} onClick={() => exportIds([...selected])}>{t('common.export')}</Button>
            <Button size="sm" variant="ghost" className="text-bad hover:text-bad" icon={<Trash size={13} />} onClick={() => setDeleteTargets([...selected])}>{t('common.delete')}</Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {profiles.length === 0 ? (
          <EmptyState icon={<UserCircle size={24} />} title={t('profiles.empty.title')} body={t('profiles.empty.body')} action={<Button variant="primary" icon={<Plus size={15} weight="bold" />} onClick={createNew}>{t('profiles.new')}</Button>} />
        ) : visible.length === 0 ? (
          <EmptyState icon={<MagnifyingGlass size={22} />} title={t('profiles.noMatch')} body="" />
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-bg text-left text-[11.5px] uppercase tracking-wide text-fg-faint">
              <tr className="border-b border-line">
                <th className="w-10 px-4 py-2"><Checkbox checked={allVisibleSelected} indeterminate={!allVisibleSelected && selected.size > 0} onChange={toggleAll} ariaLabel="select all" /></th>
                <th className="py-2 pr-4 font-medium">{t('common.name')}</th>
                <th className="py-2 pr-4 font-medium">{t('profiles.col.system')}</th>
                <th className="py-2 pr-4 font-medium">{t('profiles.col.proxy')}</th>
                <th className="py-2 pr-4 font-medium">{t('common.status')}</th>
                <th className="py-2 pr-4 font-medium">{t('profiles.col.lastLaunch')}</th>
                <th className="w-44 py-2 pr-4 text-right font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const run = runningMap.get(p.id)
                const prox = p.proxy.mode === 'saved' ? proxyMap.get(p.proxy.savedId || '') : undefined
                const custom = p.proxy.mode === 'custom' ? p.proxy.custom : undefined
                const isBusy = !!busy[p.id] || run?.state === 'starting' || run?.state === 'stopping'
                return (
                  <tr key={p.id} onDoubleClick={() => openEditor(p, false)} className={cx('group border-b border-line/70 transition-colors hover:bg-surface', selected.has(p.id) && 'bg-surface')}>
                    <td className="px-4 py-2"><Checkbox checked={selected.has(p.id)} onChange={(v) => toggle(p.id, v)} ariaLabel={p.name} /></td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <button className="truncate font-medium hover:underline" onClick={() => openEditor(p, false)}>{p.name}</button>
                            <button onClick={() => toggleFavorite(p)} aria-label={t('profiles.favorite')} className={cx('transition-opacity', p.favorite ? 'text-warn' : 'text-fg-faint opacity-0 group-hover:opacity-100')}>
                              <Star size={13} weight={p.favorite ? 'fill' : 'regular'} />
                            </button>
                          </div>
                          {p.tags.length > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{p.tags.map((x) => <Badge key={x}>{x}</Badge>)}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-fg-muted">
                      <div>{osLabel(p.fingerprint.os)}</div>
                      <div className="font-mono text-[11px] text-fg-faint">{p.fingerprint.screen.width}x{p.fingerprint.screen.height} · {p.fingerprint.locale}</div>
                    </td>
                    <td className="py-2 pr-4">
                      {prox ? (
                        <div className="flex items-center gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-mono text-[12px]">{prox.name || proxyShort(prox)}</div>
                            <div className="text-[11px] text-fg-faint">{prox.lastCheck?.countryCode ? `${prox.lastCheck.countryCode} · ${prox.lastCheck.city || prox.lastCheck.country}` : prox.protocol}</div>
                          </div>
                          {prox.lastCheck && <GradeBadge result={prox.lastCheck} compact />}
                        </div>
                      ) : custom ? (
                        <div className="font-mono text-[12px]">{proxyShort(custom)}<div className="font-sans text-[11px] text-fg-faint">{custom.protocol}</div></div>
                      ) : (
                        <span className="text-[12px] text-fg-faint">{t('profiles.directConnection')}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {run ? (
                        <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: run.state === 'running' ? 'var(--color-ok)' : 'var(--color-warn)' }}>
                          <span className={cx('h-1.5 w-1.5 rounded-full bg-current', run.state === 'running' && 'live-dot')} />
                          {run.state === 'running' ? t('common.running') : run.state === 'starting' ? t('common.starting') : t('common.stopping')}
                        </span>
                      ) : (
                        <span className="text-[12.5px] text-fg-faint">{t('common.idle')}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-[12.5px] text-fg-muted">{timeAgo(p.lastLaunchedAt)}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center justify-end gap-1">
                        {run && run.state !== 'stopping' ? (
                          <Button size="sm" variant="secondary" icon={<Stop size={12} weight="fill" />} loading={isBusy} onClick={() => stop(p)}>{t('common.stop')}</Button>
                        ) : (
                          <Button size="sm" variant="primary" icon={<Play size={12} weight="fill" />} loading={isBusy} onClick={() => launch(p)}>{t('common.launch')}</Button>
                        )}
                        <IconButton title={t('common.edit')} onClick={() => openEditor(p, false)}><PencilSimple size={15} /></IconButton>
                        <Menu
                          trigger={<IconButton title="more"><DotsThree size={18} weight="bold" /></IconButton>}
                          items={[
                            { label: t('common.clone'), icon: <Copy size={14} />, onClick: () => setCloneTarget(p) },
                            { label: t('common.export'), icon: <Export size={14} />, onClick: () => exportIds([p.id]) },
                            'sep',
                            { label: t('common.delete'), icon: <Trash size={14} />, danger: true, onClick: () => setDeleteTargets([p.id]) }
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <CloneDialog profile={cloneTarget} onClose={() => setCloneTarget(null)} />

      <Modal open={!!deleteTargets} onClose={() => setDeleteTargets(null)} title={t('common.delete')}
        footer={<>
          <Button onClick={() => setDeleteTargets(null)}>{t('common.cancel')}</Button>
          <Button onClick={() => doDelete(false)}>{t('profiles.deleteKeepData')}</Button>
          <Button variant="danger" onClick={() => doDelete(true)}>{t('profiles.deleteWipe')}</Button>
        </>}>
        <p className="text-[13px] leading-relaxed text-fg-muted">{t('profiles.deleteConfirm', { n: deleteTargets?.length || 0 })}</p>
      </Modal>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button onClick={onClick} className={cx('focus-ring inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-[12.5px] transition-colors', active ? 'border-line-strong bg-surface-3 text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg')}>
      {children}
    </button>
  )
}

function CloneDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }): JSX.Element {
  const t = useT()
  const refreshProfiles = useApp((s) => s.refreshProfiles)
  const [count, setCount] = useState(1)
  const [newFp, setNewFp] = useState(true)
  const [copyData, setCopyData] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    if (!profile) return
    setBusy(true)
    try {
      const created = await window.api.profiles.clone(profile.id, { count, newFingerprint: newFp, copyData })
      toast.ok(t('clone.done', { n: created.length }))
      refreshProfiles()
      onClose()
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={!!profile} onClose={onClose} title={`${t('clone.title')}: ${profile?.name || ''}`}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={run}>{t('common.clone')}</Button></>}>
      <div className="flex flex-col gap-4">
        <label className="flex items-center justify-between gap-4">
          <span className="text-[13px]">{t('clone.count')}</span>
          <Input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="w-24 font-mono" />
        </label>
        <Toggle checked={newFp} onChange={setNewFp} label={t('clone.newFp')} hint={t('clone.newFpHint')} />
        <Toggle checked={copyData} onChange={setCopyData} label={t('clone.copyData')} />
      </div>
    </Modal>
  )
}
