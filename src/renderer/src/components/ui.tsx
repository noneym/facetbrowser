import React, { useEffect, useRef, useState } from 'react'
import { X, Check, CaretDown } from '@phosphor-icons/react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ---- Button ----------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  icon?: React.ReactNode
  loading?: boolean
}
export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }: ButtonProps): JSX.Element {
  const base = 'focus-ring inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] font-medium transition-[background-color,border-color,transform] duration-150 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none select-none'
  const sizes = size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8.5 px-3 text-[13px]'
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-accent-ink hover:bg-accent-strong',
    secondary: 'bg-surface-2 border border-line-strong text-fg hover:bg-surface-3',
    ghost: 'text-fg-muted hover:text-fg hover:bg-surface-2',
    danger: 'bg-transparent border border-bad/40 text-bad hover:bg-bad/10'
  }
  return (
    <button className={cx(base, sizes, variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}

export function IconButton({ className, children, title, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      title={title}
      aria-label={title}
      className={cx('focus-ring inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-40 disabled:pointer-events-none', className)}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }): JSX.Element {
  return (
    <span className={cx('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent', className)} aria-hidden />
  )
}

// ---- Form -------------------------------------------------------------------
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      <span className="text-[12.5px] font-medium text-fg-muted">{label}</span>
      {children}
      {hint && !error && <span className="text-[12px] leading-snug text-fg-faint">{hint}</span>}
      {error && <span className="text-[12px] text-bad">{error}</span>}
    </label>
  )
}

const inputBase = 'focus-ring h-8.5 w-full rounded-[var(--radius-md)] border border-line bg-bg px-2.5 text-[13px] text-fg placeholder:text-fg-faint transition-colors hover:border-line-strong focus:border-accent/60 disabled:opacity-50'

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input className={cx(inputBase, className)} {...rest} />
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea className={cx(inputBase, 'h-auto min-h-24 resize-y py-2 font-mono text-[12.5px] leading-relaxed', className)} {...rest} />
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <span className="relative block">
      <select className={cx(inputBase, 'appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
      <CaretDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
    </span>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }): JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="focus-ring group flex w-full items-start gap-3 rounded-[var(--radius-md)] py-1 text-left">
      <span className={cx('relative mt-0.5 inline-block h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] text-fg">{label}</span>
        {hint && <span className="text-[12px] leading-snug text-fg-faint">{hint}</span>}
      </span>
    </button>
  )
}

export function Checkbox({ checked, onChange, indeterminate, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; indeterminate?: boolean; ariaLabel?: string }): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      onClick={(e) => { e.stopPropagation(); onChange(!checked) }}
      className={cx('focus-ring inline-flex h-4 w-4 items-center justify-center rounded-[4px] border transition-colors', checked || indeterminate ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong bg-bg hover:border-fg-faint')}
    >
      {checked && !indeterminate && <Check size={11} weight="bold" />}
      {indeterminate && <span className="h-0.5 w-2 rounded bg-accent-ink" />}
    </button>
  )
}

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }): JSX.Element {
  const [draft, setDraft] = useState('')
  const commit = (): void => {
    const v = draft.trim().replace(/,+$/, '')
    if (v && !value.includes(v)) onChange([...value, v])
    setDraft('')
  }
  return (
    <div className={cx(inputBase, 'flex h-auto min-h-8.5 flex-wrap items-center gap-1 py-1')}>
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-surface-3 px-1.5 py-0.5 text-[12px] text-fg">
          {tag}
          <button type="button" aria-label={`remove ${tag}`} onClick={() => onChange(value.filter((x) => x !== tag))} className="text-fg-faint hover:text-fg">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={commit}
        className="min-w-20 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-faint"
      />
    </div>
  )
}

// ---- Display ----------------------------------------------------------------
export function Badge({ children, color, className, mono }: { children: React.ReactNode; color?: string; className?: string; mono?: boolean }): JSX.Element {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-px text-[11.5px] font-medium leading-5', mono && 'font-mono', className)}
      style={color ? { color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` } : { color: 'var(--color-fg-muted)', borderColor: 'var(--color-line)', background: 'var(--color-surface-2)' }}
    >
      {children}
    </span>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; badge?: number | string }>; value: T; onChange: (v: T) => void }): JSX.Element {
  return (
    <div role="tablist" className="flex items-center gap-1 border-b border-line">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cx('focus-ring relative -mb-px flex h-9 items-center gap-1.5 px-3 text-[13px] transition-colors', value === tab.id ? 'text-fg' : 'text-fg-muted hover:text-fg')}
        >
          {tab.label}
          {tab.badge !== undefined && <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-mono text-fg-muted">{tab.badge}</span>}
          {value === tab.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md' }: { options: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }): JSX.Element {
  return (
    <div className="inline-flex w-fit rounded-[var(--radius-md)] border border-line bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cx('focus-ring rounded-[6px] font-medium transition-colors', size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[12.5px]', value === o.id ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }): JSX.Element {
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] border border-line bg-surface-2 text-fg-muted">{icon}</div>
      <div className="text-[15px] font-medium text-fg">{title}</div>
      <p className="max-w-[46ch] text-[13px] leading-relaxed text-fg-muted">{body}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export function SkeletonRows({ rows = 6 }: { rows?: number }): JSX.Element {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-10 w-full" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  )
}

// ---- Overlays ---------------------------------------------------------------
export function Modal({ open, onClose, title, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; width?: number }): JSX.Element {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center bg-bg/70 p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
          <motion.div
            role="dialog" aria-modal aria-label={title}
            className="flex max-h-full w-full flex-col rounded-[var(--radius-lg)] border border-line bg-surface shadow-[0_24px_64px_-16px_rgba(0,0,0,0.7)]"
            style={{ maxWidth: width }}
            initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-[14px] font-semibold">{title}</h2>
              <IconButton title="close" onClick={onClose}><X size={16} /></IconButton>
            </div>
            <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 720 }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode; width?: number }): JSX.Element {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-30 bg-bg/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
          <motion.aside
            role="dialog" aria-modal aria-label={title}
            className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-surface shadow-[-24px_0_64px_-24px_rgba(0,0,0,0.8)]"
            style={{ maxWidth: width }}
            initial={reduce ? false : { x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div>
                <h2 className="text-[14px] font-semibold">{title}</h2>
                {subtitle && <div className="text-[12px] text-fg-faint">{subtitle}</div>}
              </div>
              <IconButton title="close" onClick={onClose}><X size={16} /></IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            {footer && <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Menu({ trigger, items }: { trigger: React.ReactNode; items: Array<{ label: string; onClick: () => void; danger?: boolean; icon?: React.ReactNode } | 'sep'> }): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div ref={ref} className="relative inline-block">
      <span onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>{trigger}</span>
      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-44 overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-2 py-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]">
          {items.map((it, i) =>
            it === 'sep' ? (
              <div key={i} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick() }}
                className={cx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-3', it.danger ? 'text-bad' : 'text-fg')}
              >
                {it.icon}
                {it.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

export function Kbd({ children }: { children: React.ReactNode }): JSX.Element {
  return <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[11px] text-fg-muted">{children}</kbd>
}
