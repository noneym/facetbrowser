import type { ProxyCheckResult } from '@shared/types'
import { gradeColor } from '@/lib/format'
import { useT } from '@/lib/i18n'
import type { Key } from '@/lib/i18n'
import { cx } from './ui'

export function GradeBadge({ result, compact }: { result?: ProxyCheckResult; compact?: boolean }): JSX.Element {
  const t = useT()
  if (!result) return <span className="text-[12px] text-fg-faint">{t('proxies.notChecked')}</span>
  const color = gradeColor(result.grade)
  const q = result.quality ?? 0
  return (
    <span className="inline-flex items-center gap-2" title={result.issues?.join('\n')}>
      <span className="grid h-6 w-6 place-items-center rounded-[6px] font-mono text-[12px] font-semibold" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)` }}>
        {result.grade}
      </span>
      {!compact && (
        <span className="flex flex-col leading-tight">
          <span className="text-[12.5px]" style={{ color }}>{t(`grade.${result.verdict || 'Dead'}` as Key)}</span>
          <span className="font-mono text-[11px] text-fg-faint">{q}/100</span>
        </span>
      )}
    </span>
  )
}

export function QualityBar({ value, className }: { value: number; className?: string }): JSX.Element {
  const color = value >= 85 ? 'var(--color-ok)' : value >= 70 ? 'var(--color-good)' : value >= 50 ? 'var(--color-warn)' : value >= 30 ? 'var(--color-risk)' : 'var(--color-bad)'
  return (
    <span className={cx('inline-block h-1 w-16 overflow-hidden rounded-full bg-line', className)} aria-hidden>
      <span className="block h-full rounded-full" style={{ width: `${value}%`, background: color }} />
    </span>
  )
}
