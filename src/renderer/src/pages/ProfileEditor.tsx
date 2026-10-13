import { useEffect, useMemo, useState } from 'react'
import { ArrowsClockwise, Lightning, Play, MapPin, Copy } from '@phosphor-icons/react'
import type { Fingerprint, OsFamily, Profile, ProxyConfig, ProxyCheckResult, ProxyProtocol } from '@shared/types'
import { useApp } from '@/store/app'
import { useT, type Key } from '@/lib/i18n'
import { toast, errMsg, friendlyError } from '@/store/toast'
import { GenerateDialog, useProviderAccounts } from '@/components/Providers'
import type { ProviderAccount } from '@shared/cloud'
import { proxyShort, proxyLine, TIMEZONES, LOCALE_OPTIONS, osLabel } from '@/lib/format'
import { Button, Drawer, Field, Input, Select, Tabs, TagInput, Textarea, Toggle, Segmented, Modal, Menu, cx } from '@/components/ui'
import { GradeBadge } from '@/components/GradeBadge'
import { ProxyDetail } from './ProxiesPage'

type Tab = 'general' | 'proxy' | 'fingerprint' | 'cookies' | 'advanced'
const COLORS = ['#3ecf8e', '#e5a33d', '#5b9cf6', '#e06c75', '#c678dd', '#56b6c2', '#d19a66', '#98c379']

export function ProfileEditor(): JSX.Element {
  const t = useT()
  const editorProfile = useApp((s) => s.editorProfile)
  const isNew = useApp((s) => s.editorIsNew)
  const closeEditor = useApp((s) => s.closeEditor)
  const refreshProfiles = useApp((s) => s.refreshProfiles)
  const running = useApp((s) => s.running)

  const [draft, setDraft] = useState<Profile | null>(null)
  const [tab, setTab] = useState<Tab>('general')
  const [saving, setSaving] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => {
    setDraft(editorProfile ? structuredClone(editorProfile) : null)
    setTab('general')
  }, [editorProfile])

  const dirty = !!draft && !!editorProfile && JSON.stringify(draft) !== JSON.stringify(editorProfile)
  const isRunning = !!draft && running.some((r) => r.profileId === draft.id)

  const save = async (launch = false): Promise<Profile | null> => {
    if (!draft) return null
    setSaving(true)
    try {
      const saved = await window.api.profiles.save({ ...draft, name: draft.name.trim() || draft.name })
      await refreshProfiles()
      toast.ok(t('editor.saved'))
      if (launch) {
        try {
          await window.api.browser.launch(saved.id)
          toast.ok(t('profiles.launched', { name: saved.name }))
        } catch (e) {
          toast.err(t('profiles.launchFailed', { err: friendlyError(e) }))
        }
      }
      closeEditor()
      return saved
    } catch (e) {
      toast.err(friendlyError(e))
      return null
    } finally {
      setSaving(false)
    }
  }
  const requestClose = (): void => {
    if (dirty) setConfirmClose(true)
    else closeEditor()
  }
  const patch = (p: Partial<Profile>): void => setDraft((d) => (d ? { ...d, ...p } : d))
  const patchFp = (p: Partial<Fingerprint>): void => setDraft((d) => (d ? { ...d, fingerprint: { ...d.fingerprint, ...p } } : d))

  return (
    <>
      <Drawer
        open={!!draft}
        onClose={requestClose}
        title={isNew ? t('editor.newTitle') : t('editor.editTitle')}
        subtitle={draft?.name}
        footer={
          <>
            <span className="text-[12px] text-fg-faint">{dirty ? t('editor.unsaved') : ''}</span>
            <div className="flex items-center gap-2">
              <Button onClick={requestClose}>{t('common.cancel')}</Button>
              {!isRunning && <Button icon={<Play size={13} weight="fill" />} loading={saving} onClick={() => save(true)}>{t('common.save')} + {t('common.launch')}</Button>}
              <Button variant="primary" loading={saving} onClick={() => save(false)}>{t('common.save')}</Button>
            </div>
          </>
        }
      >
        {draft && (
          <div className="flex flex-col">
            <div className="px-5 pt-1">
              <Tabs<Tab>
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'general', label: t('editor.tab.general') },
                  { id: 'proxy', label: t('editor.tab.proxy') },
                  { id: 'fingerprint', label: t('editor.tab.fingerprint') },
                  { id: 'cookies', label: t('editor.tab.cookies') },
                  { id: 'advanced', label: t('editor.tab.advanced') }
                ]}
              />
            </div>
            <div className="px-5 py-5">
              {tab === 'general' && <GeneralTab draft={draft} patch={patch} />}
              {tab === 'proxy' && <ProxyTab draft={draft} patch={patch} patchFp={patchFp} />}
              {tab === 'fingerprint' && <FingerprintTab fp={draft.fingerprint} patchFp={patchFp} setFp={(fp) => patch({ fingerprint: fp })} />}
              {tab === 'cookies' && <CookiesTab draft={draft} isNew={isNew} />}
              {tab === 'advanced' && <AdvancedTab draft={draft} patch={patch} />}
            </div>
          </div>
        )}
      </Drawer>
      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} title={t('editor.unsaved')}
        footer={<><Button onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button><Button variant="danger" onClick={() => { setConfirmClose(false); closeEditor() }}>{t('common.close')}</Button></>}>
        <p className="text-[13px] text-fg-muted">{t('editor.unsaved')}</p>
      </Modal>
    </>
  )
}

function GeneralTab({ draft, patch }: { draft: Profile; patch: (p: Partial<Profile>) => void }): JSX.Element {
  const t = useT()
  const groups = useApp((s) => s.groups)
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
        <Field label={t('common.name')}>
          <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t('editor.name.placeholder')} autoFocus />
        </Field>
        <Field label={t('editor.color')}>
          <div className="flex h-8.5 items-center gap-1.5">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => patch({ color: c })} className="focus-ring h-5 w-5 rounded-full border-2 transition-transform hover:scale-110" style={{ background: c, borderColor: draft.color === c ? 'var(--color-fg)' : 'transparent' }} />
            ))}
          </div>
        </Field>
      </div>
      <Field label={t('common.tags')}>
        <TagInput value={draft.tags} onChange={(tags) => patch({ tags })} placeholder={t('editor.tags.placeholder')} />
      </Field>
      {groups.length > 0 && (
        <Field label={t('common.group')}>
          <Select value={draft.groupId || ''} onChange={(e) => patch({ groupId: e.target.value || undefined })}>
            <option value="">{t('common.none')}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label={t('editor.startUrls')} hint={t('editor.startUrls.hint')}>
        <Textarea rows={3} value={draft.startUrls.join('\n')} onChange={(e) => patch({ startUrls: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })} placeholder="https://" />
      </Field>
      <Field label={t('common.notes')}>
        <Textarea rows={4} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} className="font-sans" />
      </Field>
    </div>
  )
}

function ProxyTab({ draft, patch, patchFp }: { draft: Profile; patch: (p: Partial<Profile>) => void; patchFp: (p: Partial<Fingerprint>) => void }): JSX.Element {
  const t = useT()
  const proxies = useApp((s) => s.proxies)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ProxyCheckResult | null>(null)
  const [pasteLine, setPasteLine] = useState('')
  const { accounts: providerAccounts } = useProviderAccounts()
  const [genFor, setGenFor] = useState<ProviderAccount | null>(null)
  const mode = draft.proxy.mode
  const custom: ProxyConfig = draft.proxy.custom || { protocol: 'http', host: '', port: 8080 }
  const saved = useMemo(() => proxies.find((p) => p.id === draft.proxy.savedId), [proxies, draft.proxy.savedId])
  const setCustom = (c: Partial<ProxyConfig>): void => patch({ proxy: { mode: 'custom', custom: { ...custom, ...c } } })

  const applyPaste = async (): Promise<void> => {
    const parsed = await window.api.proxies.parse(pasteLine)
    if (parsed) { patch({ proxy: { mode: 'custom', custom: parsed } }); setPasteLine('') }
    else toast.err(t('common.error'))
  }
  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      if (mode === 'saved' && saved) {
        const list = await window.api.proxies.check([saved.id], { speedTest: true })
        useApp.getState().setProxies(list)
        setTestResult(list.find((p) => p.id === saved.id)?.lastCheck || null)
      } else if (mode === 'custom') {
        setTestResult(await window.api.proxies.checkConfig(custom))
      }
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setTesting(false)
    }
  }
  const adapt = async (): Promise<void> => {
    try {
      const fp = await window.api.fingerprint.adaptToProxy(draft)
      patchFp(fp)
      toast.ok(t('editor.proxy.adapted'))
    } catch (e) {
      toast.err(errMsg(e))
    }
  }
  const shownResult = mode === 'saved' ? saved?.lastCheck : testResult
  const activeConfig: ProxyConfig | null = mode === 'saved' ? (saved ? { protocol: saved.protocol, host: saved.host, port: saved.port, username: saved.username, password: saved.password } : null) : mode === 'custom' && custom.host ? custom : null
  const copyText = (text: string): void => {
    navigator.clipboard.writeText(text)
    toast.ok(t('common.copied'))
  }

  return (
    <div className="flex flex-col gap-5">
      <Field label={t('editor.proxy.mode')}>
        <Segmented<'none' | 'saved' | 'custom'>
          value={mode}
          onChange={(m) => patch({ proxy: m === 'none' ? { mode: 'none' } : m === 'saved' ? { mode: 'saved', savedId: draft.proxy.savedId || proxies[0]?.id } : { mode: 'custom', custom } })}
          options={[{ id: 'none', label: t('editor.proxy.none') }, { id: 'saved', label: t('editor.proxy.saved') }, { id: 'custom', label: t('editor.proxy.custom') }]}
        />
      </Field>

      {providerAccounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-line bg-bg px-3 py-2">
          <span className="text-[12.5px] text-fg-muted">{t('prov.fromProvider')}:</span>
          {providerAccounts.map((acc) => (
            <Button key={acc.id} size="sm" icon={<Lightning size={12} weight="fill" />} onClick={() => setGenFor(acc)}>{acc.label}</Button>
          ))}
        </div>
      )}
      <GenerateDialog acc={genFor} single onClose={() => setGenFor(null)} onGenerated={(saved) => { if (saved[0]) { patch({ proxy: { mode: 'saved', savedId: saved[0].id } }); toast.ok(t('prov.assigned')) } }} />

      {mode === 'saved' && (
        proxies.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted">{t('editor.proxy.noSaved')}</p>
        ) : (
          <Field label={t('editor.proxy.pick')}>
            <Select value={draft.proxy.savedId || ''} onChange={(e) => patch({ proxy: { mode: 'saved', savedId: e.target.value } })}>
              {proxies.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.name || proxyShort(p))} · {p.protocol}{p.lastCheck ? ` · ${p.lastCheck.countryCode || '?'} · ${p.lastCheck.grade}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )
      )}

      {mode === 'custom' && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Input value={pasteLine} onChange={(e) => setPasteLine(e.target.value)} placeholder={t('editor.proxy.paste')} className="font-mono text-[12px]" onKeyDown={(e) => { if (e.key === 'Enter') applyPaste() }} />
            <Button onClick={applyPaste} disabled={!pasteLine.trim()}>{t('common.apply')}</Button>
          </div>
          <div className="grid grid-cols-[120px_1fr_100px] gap-3">
            <Field label={t('editor.proxy.protocol')}>
              <Select value={custom.protocol} onChange={(e) => setCustom({ protocol: e.target.value as ProxyProtocol })}>
                <option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option><option value="socks4">SOCKS4</option>
              </Select>
            </Field>
            <Field label={t('editor.proxy.host')}><Input value={custom.host} onChange={(e) => setCustom({ host: e.target.value.trim() })} className="font-mono text-[12.5px]" /></Field>
            <Field label={t('editor.proxy.port')}><Input type="number" value={custom.port} onChange={(e) => setCustom({ port: Number(e.target.value) || 0 })} className="font-mono" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('editor.proxy.user')}><Input value={custom.username || ''} onChange={(e) => setCustom({ username: e.target.value })} className="font-mono text-[12.5px]" placeholder={t('common.optional')} /></Field>
            <Field label={t('editor.proxy.pass')}><Input type="password" value={custom.password || ''} onChange={(e) => setCustom({ password: e.target.value })} className="font-mono text-[12.5px]" placeholder={t('common.optional')} /></Field>
          </div>
        </div>
      )}

      {mode !== 'none' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={<ArrowsClockwise size={14} />} loading={testing} onClick={test} disabled={(mode === 'saved' && !saved) || (mode === 'custom' && !custom.host)}>{t('editor.proxy.test')}</Button>
            <Button icon={<MapPin size={14} />} onClick={adapt} disabled={mode !== 'saved' || !saved?.lastCheck?.countryCode} title={t('editor.proxy.adaptHint')}>{t('editor.proxy.adapt')}</Button>
            {activeConfig && (
              <Menu
                trigger={<Button icon={<Copy size={14} />}>{t('common.copy')}</Button>}
                items={[
                  { label: proxyLine(activeConfig), onClick: () => copyText(proxyLine(activeConfig)) },
                  { label: `${activeConfig.host}:${activeConfig.port}${activeConfig.username ? `:${activeConfig.username}:${activeConfig.password || ''}` : ''}`, onClick: () => copyText(`${activeConfig.host}:${activeConfig.port}${activeConfig.username ? `:${activeConfig.username}:${activeConfig.password || ''}` : ''}`) },
                  { label: proxyLine(activeConfig, false), onClick: () => copyText(proxyLine(activeConfig, false)) }
                ]}
              />
            )}
            {shownResult && <GradeBadge result={shownResult} />}
          </div>
          {shownResult && (
            <div className="rounded-[var(--radius-md)] border border-line bg-bg p-4">
              <div className="mb-2 flex items-center gap-3 font-mono text-[12.5px]"><span>{shownResult.ip}</span><span className="text-fg-faint">{shownResult.countryCode} · {shownResult.city} · {shownResult.isp}</span></div>
              <ProxyDetail r={shownResult} />
            </div>
          )}
          <p className="text-[12px] leading-relaxed text-fg-faint">{t('editor.proxy.bridgeNote')}</p>
        </>
      )}
    </div>
  )
}

function FingerprintTab({ fp, patchFp, setFp }: { fp: Fingerprint; patchFp: (p: Partial<Fingerprint>) => void; setFp: (fp: Fingerprint) => void }): JSX.Element {
  const t = useT()
  const info = useApp((s) => s.info)
  const hostOs: OsFamily = info?.platform === 'win32' ? 'windows' : info?.platform === 'darwin' ? 'macos' : 'linux'
  const [regen, setRegen] = useState(false)
  const regenerate = async (os?: OsFamily): Promise<void> => {
    setRegen(true)
    try {
      const next = await window.api.fingerprint.generate({ os: os || fp.os })
      // keep location-related choices the user may have made deliberately
      setFp({ ...next, timezone: fp.timezone, geolocation: fp.geolocation, webrtc: fp.webrtc })
    } finally {
      setRegen(false)
    }
  }
  const noiseOptions: Array<{ id: 'noise' | 'off' | 'real'; label: string }> = [{ id: 'noise', label: t('common.noise') }, { id: 'off', label: t('common.block') }, { id: 'real', label: t('common.real') }]

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-center justify-between gap-3">
        <Field label={t('fp.os')} className="w-48">
          <Select value={fp.os} onChange={(e) => regenerate(e.target.value as OsFamily)}>
            {(['windows', 'macos', 'linux', 'android'] as OsFamily[]).map((o) => <option key={o} value={o}>{osLabel(o)}</option>)}
          </Select>
        </Field>
        <Button icon={<Lightning size={14} weight="fill" />} loading={regen} onClick={() => regenerate()}>{t('fp.regenerate')}</Button>
      </div>

      <Group title={t('fp.section.identity')}>
        <p className={cx('rounded-[var(--radius-md)] border px-3 py-2 text-[12px] leading-relaxed', fp.os === hostOs ? 'border-ok/30 bg-ok/8 text-ok' : 'border-warn/30 bg-warn/8 text-warn')}>
          {fp.os === hostOs ? t('fp.nativeNote') : t('fp.crossOsNote')}
        </p>
        <Field label={t('fp.userAgent')} hint={t('fp.uaHint')}>
          <Input value={fp.userAgent} onChange={(e) => patchFp({ userAgent: e.target.value })} className="font-mono text-[12px]" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('fp.webglVendor')}><Input value={fp.webgl.vendor} onChange={(e) => patchFp({ webgl: { ...fp.webgl, vendor: e.target.value } })} className="font-mono text-[12px]" /></Field>
          <Field label={t('fp.webglRenderer')}><Input value={fp.webgl.renderer} onChange={(e) => patchFp({ webgl: { ...fp.webgl, renderer: e.target.value } })} className="font-mono text-[12px]" /></Field>
        </div>
      </Group>

      <Group title={t('fp.section.hw')}>
        <div className="grid grid-cols-4 gap-3">
          <Field label={`${t('fp.screen')} W`}><Input type="number" value={fp.screen.width} onChange={(e) => patchFp({ screen: { ...fp.screen, width: Number(e.target.value) || 0 } })} className="font-mono" /></Field>
          <Field label={`${t('fp.screen')} H`}><Input type="number" value={fp.screen.height} onChange={(e) => patchFp({ screen: { ...fp.screen, height: Number(e.target.value) || 0 } })} className="font-mono" /></Field>
          <Field label={t('fp.pixelRatio')}><Input type="number" step={0.25} value={fp.screen.pixelRatio} onChange={(e) => patchFp({ screen: { ...fp.screen, pixelRatio: Number(e.target.value) || 1 } })} className="font-mono" /></Field>
          <Field label={t('fp.touch')}><Input type="number" value={fp.maxTouchPoints} onChange={(e) => patchFp({ maxTouchPoints: Number(e.target.value) || 0 })} className="font-mono" /></Field>
          <Field label={t('fp.cores')}>
            <Select value={fp.hardwareConcurrency} onChange={(e) => patchFp({ hardwareConcurrency: Number(e.target.value) })}>{[2, 4, 6, 8, 10, 12, 16, 24, 32].map((n) => <option key={n} value={n}>{n}</option>)}</Select>
          </Field>
          <Field label={t('fp.memory')}>
            <Select value={fp.deviceMemory} onChange={(e) => patchFp({ deviceMemory: Number(e.target.value) })}>{[0.25, 0.5, 1, 2, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}</Select>
          </Field>
          <Field label={t('fp.mic')}><Input type="number" min={0} value={fp.mediaDevices.audioInputs} onChange={(e) => patchFp({ mediaDevices: { ...fp.mediaDevices, audioInputs: Number(e.target.value) || 0 } })} className="font-mono" /></Field>
          <Field label={t('fp.camera')}><Input type="number" min={0} value={fp.mediaDevices.videoInputs} onChange={(e) => patchFp({ mediaDevices: { ...fp.mediaDevices, videoInputs: Number(e.target.value) || 0 } })} className="font-mono" /></Field>
        </div>
      </Group>

      <Group title={t('fp.section.locale')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('fp.locale')}>
            <Select value={fp.locale} onChange={(e) => { const l = e.target.value; patchFp({ locale: l, languages: [l, l.split('-')[0], ...(l.startsWith('en') ? [] : ['en'])] }) }}>
              {[...new Set([fp.locale, ...LOCALE_OPTIONS])].map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
          <Field label={t('fp.languages')}>
            <Input value={fp.languages.join(', ')} onChange={(e) => patchFp({ languages: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} className="font-mono text-[12.5px]" />
          </Field>
          <Field label={t('fp.timezone')} hint={t('fp.timezoneHint')}>
            <Select value={fp.timezone} onChange={(e) => patchFp({ timezone: e.target.value })}>
              <option value="auto">{t('fp.timezoneAuto')}</option>
              {[...new Set([fp.timezone, ...TIMEZONES])].filter((z) => z !== 'auto').map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
          </Field>
          <Field label={t('fp.geo')}>
            <Select value={fp.geolocation.mode} onChange={(e) => patchFp({ geolocation: { ...fp.geolocation, mode: e.target.value as Fingerprint['geolocation']['mode'] } })}>
              <option value="auto">{t('fp.geo.auto')}</option>
              <option value="custom">{t('fp.geo.custom')}</option>
              <option value="prompt">{t('fp.geo.prompt')}</option>
              <option value="off">{t('fp.geo.off')}</option>
            </Select>
          </Field>
          {fp.geolocation.mode === 'custom' && (
            <>
              <Field label={t('fp.lat')}><Input type="number" step={0.0001} value={fp.geolocation.lat ?? ''} onChange={(e) => patchFp({ geolocation: { ...fp.geolocation, lat: Number(e.target.value) } })} className="font-mono" /></Field>
              <Field label={t('fp.lon')}><Input type="number" step={0.0001} value={fp.geolocation.lon ?? ''} onChange={(e) => patchFp({ geolocation: { ...fp.geolocation, lon: Number(e.target.value) } })} className="font-mono" /></Field>
            </>
          )}
        </div>
      </Group>

      <Group title={t('fp.section.noise')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Row label={t('fp.canvas')}><Segmented size="sm" value={fp.canvas} onChange={(v) => patchFp({ canvas: v })} options={noiseOptions} /></Row>
          <Row label={t('fp.webgl')}><Segmented size="sm" value={fp.webgl.mode} onChange={(v) => patchFp({ webgl: { ...fp.webgl, mode: v } })} options={noiseOptions} /></Row>
          <Row label={t('fp.audio')}><Segmented size="sm" value={fp.audio} onChange={(v) => patchFp({ audio: v })} options={noiseOptions.filter((o) => o.id !== 'off')} /></Row>
          <Row label={t('fp.rects')}><Segmented size="sm" value={fp.clientRects} onChange={(v) => patchFp({ clientRects: v })} options={noiseOptions.filter((o) => o.id !== 'off')} /></Row>
          <Row label={t('fp.webrtc')}>
            <Select value={fp.webrtc} onChange={(e) => patchFp({ webrtc: e.target.value as Fingerprint['webrtc'] })} className="h-7 w-52 text-[12.5px]">
              <option value="altered">{t('fp.webrtc.altered')}</option><option value="disabled">{t('fp.webrtc.disabled')}</option><option value="real">{t('fp.webrtc.real')}</option>
            </Select>
          </Row>
          <Row label={t('fp.fonts')}>
            <Select value={fp.fonts} onChange={(e) => patchFp({ fonts: e.target.value as Fingerprint['fonts'] })} className="h-7 w-52 text-[12.5px]">
              <option value="mask">{t('fp.fonts.mask')}</option><option value="real">{t('fp.fonts.real')}</option>
            </Select>
          </Row>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <Toggle checked={fp.batteryMask} onChange={(v) => patchFp({ batteryMask: v })} label={t('fp.battery')} />
          <Toggle checked={fp.doNotTrack === true} onChange={(v) => patchFp({ doNotTrack: v ? true : null })} label={t('fp.dnt')} />
        </div>
        <Field label={t('fp.seed')} hint={t('fp.seedHint')} className="mt-2 w-64">
          <div className="flex gap-2">
            <Input value={fp.seed} onChange={(e) => patchFp({ seed: Number(e.target.value) >>> 0 })} className="font-mono" />
            <Button size="md" onClick={() => patchFp({ seed: Math.floor(Math.random() * 0xffffffff) })} icon={<ArrowsClockwise size={14} />} />
          </div>
        </Field>
      </Group>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-line bg-bg px-3 py-2">
      <span className="text-[13px]">{label}</span>
      {children}
    </div>
  )
}

function CookiesTab({ draft, isNew }: { draft: Profile; isNew: boolean }): JSX.Element {
  const t = useT()
  const refreshProfiles = useApp((s) => s.refreshProfiles)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'import' | 'export' | 'clear' | null>(null)
  const guard = (): boolean => {
    if (isNew) { toast.err(t('cookies.saveFirst')); return false }
    return true
  }
  const doImport = async (): Promise<void> => {
    if (!guard() || !text.trim()) return
    setBusy('import')
    try {
      const n = await window.api.cookies.import(draft.id, text)
      toast.ok(t('cookies.imported', { n }))
      setText('')
      refreshProfiles()
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setBusy(null)
    }
  }
  const doExport = async (): Promise<void> => {
    if (!guard()) return
    setBusy('export')
    try {
      const cookies = await window.api.cookies.export(draft.id)
      const path = await window.api.app.saveText({ defaultPath: `${draft.name.replace(/[^\w-]+/g, '_')}-cookies.json`, content: JSON.stringify(cookies, null, 2), filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (path) toast.ok(t('cookies.exported', { n: cookies.length }))
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setBusy(null)
    }
  }
  const doClear = async (): Promise<void> => {
    if (!guard()) return
    setBusy('clear')
    try {
      await window.api.cookies.clear(draft.id)
      toast.ok(t('cookies.cleared'))
      refreshProfiles()
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] leading-relaxed text-fg-muted">{t('cookies.hint')}</p>
      <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder='[{"name":"session","value":"...","domain":".example.com","path":"/"}]' />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={busy === 'import'} disabled={!text.trim() || !!busy} onClick={doImport}>{t('cookies.import')}</Button>
        <Button loading={busy === 'export'} disabled={!!busy} onClick={doExport}>{t('cookies.export')}</Button>
        <Button variant="danger" loading={busy === 'clear'} disabled={!!busy} onClick={doClear}>{t('cookies.clear')}</Button>
        {busy && <span className="text-[12px] text-fg-faint">{t('cookies.working')}</span>}
      </div>
      {typeof draft.cookieCount === 'number' && <div className="text-[12.5px] text-fg-muted">{t('cookies.count')}: <span className="font-mono text-fg">{draft.cookieCount}</span></div>}
    </div>
  )
}

function AdvancedTab({ draft, patch }: { draft: Profile; patch: (p: Partial<Profile>) => void }): JSX.Element {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  return (
    <div className="flex flex-col gap-5">
      <Field label={t('editor.extensions')} hint={t('editor.extensions.hint')}>
        <Textarea rows={3} value={draft.extensions.join('\n')} onChange={(e) => patch({ extensions: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })} placeholder="C:\\extensions\\my-extension" />
      </Field>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[12.5px]">
        <dt className="text-fg-muted">ID</dt><dd className="font-mono">{draft.id}</dd>
        <dt className="text-fg-muted">{t('settings.profilesDir')}</dt>
        <dd className="font-mono"><button className="text-left hover:underline" onClick={() => window.api.app.openPath(`${settings.profilesDir}\\${draft.id}`)}>{settings.profilesDir}\{draft.id}</button></dd>
        <dt className="text-fg-muted">{t(`fp.seed` as Key)}</dt><dd className="font-mono">{draft.fingerprint.seed}</dd>
      </dl>
    </div>
  )
}
