import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle, WarningCircle, Info, X } from '@phosphor-icons/react'
import { useToast } from '@/store/toast'

export function Toasts(): JSX.Element {
  const toasts = useToast((s) => s.toasts)
  const remove = useToast((s) => s.remove)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="pointer-events-auto flex items-start gap-2 rounded-[var(--radius-md)] border border-line bg-surface-2 px-3 py-2.5 text-[13px] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7)]"
          >
            <span className="mt-px shrink-0" style={{ color: t.kind === 'ok' ? 'var(--color-ok)' : t.kind === 'err' ? 'var(--color-bad)' : 'var(--color-info)' }}>
              {t.kind === 'ok' ? <CheckCircle size={16} weight="fill" /> : t.kind === 'err' ? <WarningCircle size={16} weight="fill" /> : <Info size={16} weight="fill" />}
            </span>
            <span className="flex-1 break-words leading-snug">{t.text}</span>
            <button onClick={() => remove(t.id)} className="text-fg-faint hover:text-fg" aria-label="dismiss"><X size={14} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
