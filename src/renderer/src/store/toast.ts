import { create } from 'zustand'
import { t, type Key } from '@/lib/i18n'

export interface Toast {
  id: number
  kind: 'ok' | 'err' | 'info'
  text: string
}

interface ToastState {
  toasts: Toast[]
  push: (kind: Toast['kind'], text: string) => void
  remove: (id: number) => void
}

let seq = 1
export const useToast = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, text) => {
    const id = seq++
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'err' ? 6000 : 3200)
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export const toast = {
  ok: (text: string) => useToast.getState().push('ok', text),
  err: (text: string) => useToast.getState().push('err', text),
  info: (text: string) => useToast.getState().push('info', text)
}

export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

// Known machine codes from main/cloud get a translated sentence.
export function friendlyError(e: unknown): string {
  const code = errMsg(e)
  const gate = ['not_logged_in', 'email_not_verified', 'plan_inactive', 'offline_too_long', 'profile_limit']
  if (gate.includes(code)) return t(`gate.${code}` as Key)
  if (code === 'engine_not_installed') return t('engine.needed')
  if (['bad_extension_id', 'extension_not_found', 'bad_extension_package', 'source_running', 'no_extension_data', 'not_shareable'].includes(code)) return t(`ext.err.${code}` as Key)
  if (code.startsWith('network')) return t('auth.err.network')
  return code
}
