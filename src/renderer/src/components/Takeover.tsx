import { useState } from 'react'
import { create } from 'zustand'
import type { Profile } from '@shared/types'
import { useT, t } from '@/lib/i18n'
import { toast, errMsg, friendlyError } from '@/store/toast'
import { Button, Modal } from '@/components/ui'

// A profile is open on another device of the account: launching here is
// refused until that device closes it. "Force stop" asks it to close the
// profile and upload its session, then opens the profile here with it.
interface TakeoverState {
  profile: Profile | null
  device: string
  open: (profile: Profile, device: string) => void
  close: () => void
}

const useTakeover = create<TakeoverState>((set) => ({
  profile: null,
  device: '',
  open: (profile, device) => set({ profile, device }),
  close: () => set({ profile: null, device: '' })
}))

const ELSEWHERE = 'running_elsewhere:'

// Launch used by every Launch button. Returns true when the profile started.
export async function launchProfile(p: Profile): Promise<boolean> {
  try {
    await window.api.browser.launch(p.id)
    toast.ok(t('profiles.launched', { name: p.name }))
    return true
  } catch (e) {
    const msg = errMsg(e)
    if (msg.startsWith(ELSEWHERE)) useTakeover.getState().open(p, msg.slice(ELSEWHERE.length))
    else toast.err(t('profiles.launchFailed', { err: friendlyError(e) }))
    return false
  }
}

export function TakeoverDialog(): JSX.Element {
  const tr = useT()
  const { profile, device, close } = useTakeover()
  const [busy, setBusy] = useState(false)

  const forceStop = async (): Promise<void> => {
    if (!profile) return
    setBusy(true)
    try {
      await window.api.browser.launch(profile.id, true)
      toast.ok(t('profiles.launched', { name: profile.name }))
      close()
    } catch (e) {
      toast.err(t('profiles.launchFailed', { err: friendlyError(e) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!profile} onClose={() => !busy && close()} title={tr('takeover.title')}
      footer={<>
        <Button disabled={busy} onClick={close}>{tr('common.cancel')}</Button>
        <Button variant="danger" loading={busy} onClick={forceStop}>{tr('takeover.forceStop')}</Button>
      </>}>
      <p className="text-[13px] leading-relaxed text-fg-muted">
        {busy ? tr('takeover.waiting', { device: device || tr('takeover.otherDevice') }) : tr('takeover.body', { name: profile?.name || '', device: device || tr('takeover.otherDevice') })}
      </p>
    </Modal>
  )
}
