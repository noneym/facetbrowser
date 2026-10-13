import { useEffect, useState } from 'react'
import { Plus, Trash, ArrowsClockwise, Lightning } from '@phosphor-icons/react'
import type { ProviderAccount, ProviderBalance, ProviderCountry, ProviderId } from '@shared/cloud'
import type { SavedProxy } from '@shared/types'
import { useApp } from '@/store/app'
import { useT } from '@/lib/i18n'
import { toast, errMsg } from '@/store/toast'
import { Button, Field, Input, Modal, Select, Toggle, IconButton, Spinner, cx } from '@/components/ui'

type Meta = Awaited<ReturnType<typeof window.api.providers.meta>>[number]

export function useProviderAccounts(): { accounts: ProviderAccount[]; meta: Meta[]; reload: () => Promise<void>; loading: boolean } {
  const cloud = useApp((s) => s.cloud)
  const [accounts, setAccounts] = useState<ProviderAccount[]>([])
  const [meta, setMeta] = useState<Meta[]>([])
  const [loading, setLoading] = useState(false)
  const reload = async (): Promise<void> => {
    if (!cloud?.loggedIn) return
    setLoading(true)
    try {
      const [a, m] = await Promise.all([window.api.providers.accounts(), window.api.providers.meta()])
      setAccounts(a)
      setMeta(m)
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [cloud?.loggedIn]) // eslint-disable-line react-hooks/exhaustive-deps
  return { accounts, meta, reload, loading }
}

export function ProvidersDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const t = useT()
  const { accounts, meta, reload, loading } = useProviderAccounts()
  const [adding, setAdding] = useState(false)
  const [genFor, setGenFor] = useState<ProviderAccount | null>(null)
  const [balances, setBalances] = useState<Record<string, ProviderBalance | 'loading'>>({})

  const loadBalance = async (acc: ProviderAccount): Promise<void> => {
    setBalances((b) => ({ ...b, [acc.id]: 'loading' }))
    const r = await window.api.providers.balance(acc.id).catch((e) => ({ ok: false, error: errMsg(e), lines: [] } as ProviderBalance))
    setBalances((b) => ({ ...b, [acc.id]: r }))
  }
  useEffect(() => { accounts.forEach((a) => { if (!balances[a.id]) loadBalance(a) }) }, [accounts]) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (acc: ProviderAccount): Promise<void> => {
    await window.api.providers.delete(acc.id)
    toast.ok(t('prov.deleted'))
    reload()
  }

  return (
    <>
      <Modal open={open && !adding && !genFor} onClose={onClose} title={t('prov.title')} width={640}
        footer={<><Button onClick={onClose}>{t('common.close')}</Button><Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setAdding(true)}>{t('prov.add')}</Button></>}>
        <p className="mb-4 text-[12.5px] text-fg-muted">{t('prov.subtitle')}</p>
        {loading && accounts.length === 0 ? <div className="flex items-center gap-2 text-[13px] text-fg-muted"><Spinner /> {t('common.loading')}</div> : accounts.length === 0 ? (
          <p className="text-[13px] text-fg-faint">{t('prov.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {accounts.map((acc) => {
              const m = meta.find((x) => x.id === acc.provider)
              const bal = balances[acc.id]
              return (
                <li key={acc.id} className="rounded-[var(--radius-md)] border border-line bg-bg p-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium">{acc.label}</div>
                      <div className="text-[11.5px] text-fg-faint">{m?.name || acc.provider}</div>
                    </div>
                    <IconButton title={t('prov.balance')} onClick={() => loadBalance(acc)}><ArrowsClockwise size={15} /></IconButton>
                    <Button size="sm" variant="primary" icon={<Lightning size={13} weight="fill" />} onClick={() => setGenFor(acc)}>{t('prov.generate')}</Button>
                    <IconButton title={t('common.delete')} className="hover:text-bad" onClick={() => remove(acc)}><Trash size={15} /></IconButton>
                  </div>
                  <div className="mt-2 text-[12px]">
                    {bal === 'loading' || !bal ? <span className="flex items-center gap-1.5 text-fg-faint"><Spinner className="h-3 w-3" /> {t('prov.balance')}</span>
                      : !bal.ok ? <span className="text-bad">{bal.error}</span>
                      : <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">{bal.lines.map((l) => <><span key={l.label + 'k'} className="text-fg-muted">{l.label}</span><span key={l.label + 'v'} className="font-mono text-fg">{l.value}</span></>)}</div>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
      <AddAccountDialog open={adding} meta={meta} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />
      <GenerateDialog acc={genFor} onClose={() => setGenFor(null)} />
    </>
  )
}

function AddAccountDialog({ open, meta, onClose, onSaved }: { open: boolean; meta: Meta[]; onClose: () => void; onSaved: () => void }): JSX.Element {
  const t = useT()
  const [provider, setProvider] = useState<ProviderId>('gonzoproxy')
  const [label, setLabel] = useState('')
  const [creds, setCreds] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const m = meta.find((x) => x.id === provider)
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.providers.save({ id: '', provider, label: label.trim() || m?.name || provider, credentials: creds })
      toast.ok(t('prov.saved'))
      setCreds({})
      setLabel('')
      onSaved()
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  const missing = (m?.fields || []).some((f) => !f.optional && !creds[f.key]?.trim())
  return (
    <Modal open={open} onClose={onClose} title={t('prov.add')} width={520}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={missing} onClick={save}>{t('common.save')}</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label={t('prov.provider')}>
          <Select value={provider} onChange={(e) => { setProvider(e.target.value as ProviderId); setCreds({}) }}>
            {meta.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <Field label={t('prov.label')}><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={m?.name} /></Field>
        {(m?.fields || []).map((f) => (
          <Field key={f.key} label={`${f.label}${f.optional ? ` (${t('common.optional')})` : ''}`} hint={f.hint}>
            <Input type={f.secret ? 'password' : 'text'} value={creds[f.key] || ''} onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))} className="font-mono text-[12.5px]" autoComplete="off" />
          </Field>
        ))}
      </div>
    </Modal>
  )
}

export function GenerateDialog({ acc, onClose, onGenerated, single }: { acc: ProviderAccount | null; onClose: () => void; onGenerated?: (saved: SavedProxy[]) => void; single?: boolean }): JSX.Element {
  const t = useT()
  const setProxies = useApp((s) => s.setProxies)
  const [countries, setCountries] = useState<ProviderCountry[]>([])
  const [country, setCountry] = useState('US')
  const [count, setCount] = useState(single ? 1 : 5)
  const [sticky, setSticky] = useState(true)
  const [ttl, setTtl] = useState(24)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!acc) return
    setCountries([])
    window.api.providers.countries(acc.id).then(setCountries).catch(() => setCountries([]))
  }, [acc])
  const run = async (): Promise<void> => {
    if (!acc) return
    setBusy(true)
    try {
      const r = await window.api.providers.generate(acc.id, { country: country || undefined, count: single ? 1 : count, sticky, ttlHours: ttl }, true)
      setProxies(await window.api.proxies.list())
      toast.ok(t('prov.generated', { n: r.saved.length }))
      onGenerated?.(r.saved)
      onClose()
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={!!acc} onClose={onClose} title={`${t('prov.generate')}: ${acc?.label || ''}`} width={460}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={run} icon={<Lightning size={14} weight="fill" />}>{t('prov.generate')}</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label={t('prov.country')}>
          {countries.length ? (
            <Select value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">{t('prov.anyCountry')}</option>
              {countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
            </Select>
          ) : (
            <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} placeholder="US" className="w-28 font-mono" maxLength={2} />
          )}
        </Field>
        {!single && <Field label={t('prov.count')}><Input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="w-28 font-mono" /></Field>}
        <Toggle checked={sticky} onChange={setSticky} label={sticky ? t('prov.sticky') : t('prov.rotating')} />
        {sticky && <Field label={t('prov.ttl')} hint={acc?.provider === '2captcha' ? '2Captcha: max 2 h' : 'GonzoProxy: max 168 h'}><Input type="number" min={1} max={168} value={ttl} onChange={(e) => setTtl(Math.max(1, Math.min(168, Number(e.target.value) || 24)))} className={cx('w-28 font-mono')} /></Field>}
      </div>
    </Modal>
  )
}
