import { useState } from 'react'
import { useApp } from '@/store/app'
import { useT, type Key } from '@/lib/i18n'
import { toast, errMsg } from '@/store/toast'
import { Button, Field, Input, Segmented } from '@/components/ui'

export function AuthScreen(): JSX.Element {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const setCloud = useApp((s) => s.setCloud)
  const refreshAll = useApp((s) => s.refreshAll)
  const saveSettings = useApp((s) => s.saveSettings)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [server, setServer] = useState(settings.apiBaseUrl)
  const [showServer, setShowServer] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      if (server.trim() && server.trim() !== settings.apiBaseUrl) await saveSettings({ apiBaseUrl: server.trim().replace(/\/$/, '') })
      const status = mode === 'login' ? await window.api.cloud.login(email.trim(), password) : await window.api.cloud.register(email.trim(), password)
      setCloud(status)
      await refreshAll()
      if (mode === 'register') toast.ok(t('account.verify'))
    } catch (x) {
      const code = errMsg(x)
      const key = `auth.err.${code.startsWith('network') ? 'network' : code}` as Key
      const text = t(key)
      setErr(text === key ? code : text)
    } finally {
      setBusy(false)
    }
  }
  const forgot = async (): Promise<void> => {
    if (!email.trim()) { setErr(t('auth.err.validation')); return }
    try {
      await window.api.cloud.forgot(email.trim())
      toast.ok(t('auth.forgotSent'))
    } catch (x) {
      setErr(errMsg(x))
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-accent text-accent-ink">
            <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden><path d="M6 1 11 4.2 9.2 10H2.8L1 4.2Z" fill="currentColor" /></svg>
          </span>
          <span className="text-[16px] font-semibold tracking-tight">FacetBrowser</span>
        </div>
        <h1 className="text-[20px] font-semibold tracking-tight">{t('auth.title')}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{t('auth.subtitle')}</p>
        <div className="mt-5">
          <Segmented<'login' | 'register'> value={mode} onChange={(m) => { setMode(m); setErr('') }} options={[{ id: 'login', label: t('auth.signIn') }, { id: 'register', label: t('auth.register') }]} />
        </div>
        <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
          <Field label={t('auth.email')}><Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></Field>
          <Field label={t('auth.password')} hint={mode === 'register' ? t('auth.registerHint') : undefined}><Input type="password" required minLength={mode === 'register' ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {err && <div className="rounded-[var(--radius-md)] border border-bad/30 bg-bad/8 px-3 py-2 text-[12.5px] text-bad">{err}</div>}
          <Button type="submit" variant="primary" loading={busy} className="h-10">{mode === 'login' ? t('auth.signIn') : t('auth.register')}</Button>
        </form>
        <div className="mt-4 flex items-center justify-between text-[12.5px] text-fg-muted">
          {mode === 'login' ? <button className="hover:text-fg" onClick={forgot}>{t('auth.forgot')}</button> : <span />}
          <button className="hover:text-fg" onClick={() => setShowServer((v) => !v)}>{t('auth.server')}</button>
        </div>
        {showServer && (
          <div className="mt-3">
            <Field label={t('auth.server')}><Input value={server} onChange={(e) => setServer(e.target.value)} className="font-mono text-[12px]" placeholder="https://facetbrowser.com" /></Field>
          </div>
        )}
        <p className="mt-6 text-[12px] text-fg-faint">{t('auth.offlineNote')}</p>
      </div>
    </div>
  )
}
