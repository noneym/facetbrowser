import type { Grade, ProxyConfig, SavedProxy } from '@shared/types'
import { t } from './i18n'

export function timeAgo(ts?: number): string {
  if (!ts) return t('common.never')
  const diff = Math.max(0, Date.now() - ts)
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('common.justNow')
  if (m < 60) return t('common.minAgo', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('common.hourAgo', { n: h })
  return t('common.dayAgo', { n: Math.floor(h / 24) })
}

export function proxyLine(p: ProxyConfig, withAuth = true): string {
  const auth = withAuth && p.username ? `${p.username}:${p.password || ''}@` : ''
  return `${p.protocol}://${auth}${p.host}:${p.port}`
}

export function proxyShort(p: ProxyConfig): string {
  return `${p.host}:${p.port}`
}

export function gradeColor(grade?: Grade): string {
  switch (grade) {
    case 'A': return 'var(--color-ok)'
    case 'B': return 'var(--color-good)'
    case 'C': return 'var(--color-warn)'
    case 'D': return 'var(--color-risk)'
    case 'F': return 'var(--color-bad)'
    default: return 'var(--color-fg-faint)'
  }
}

export function latencyColor(ms?: number): string {
  if (ms === undefined) return 'var(--color-fg-faint)'
  if (ms < 600) return 'var(--color-ok)'
  if (ms < 1500) return 'var(--color-warn)'
  return 'var(--color-bad)'
}

export function kbps(v?: number): string {
  if (v === undefined) return ''
  if (v >= 1000) return `${(v / 1000).toFixed(1)} Mbps`
  return `${v} kbps`
}

export function osLabel(os: string): string {
  return { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android' }[os] || os
}

export function proxyBucket(p: SavedProxy): 'good' | 'bad' | 'unchecked' {
  if (!p.lastCheck) return 'unchecked'
  if (!p.lastCheck.ok) return 'bad'
  return (p.lastCheck.quality ?? 0) >= 50 ? 'good' : 'bad'
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

export const TIMEZONES = [
  'Europe/Istanbul', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam',
  'Europe/Warsaw', 'Europe/Moscow', 'Europe/Kiev', 'Europe/Stockholm', 'Europe/Athens', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo', 'America/Mexico_City',
  'America/Bogota', 'America/Argentina/Buenos_Aires', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore',
  'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Tel_Aviv', 'Africa/Cairo', 'Africa/Johannesburg',
  'Africa/Lagos', 'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland'
]

export const LOCALE_OPTIONS = [
  'en-US', 'en-GB', 'en-CA', 'en-AU', 'de-DE', 'fr-FR', 'tr-TR', 'es-ES', 'es-MX', 'it-IT', 'nl-NL', 'pl-PL', 'pt-BR', 'pt-PT',
  'ru-RU', 'uk-UA', 'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW', 'sv-SE', 'nb-NO', 'da-DK', 'fi-FI', 'cs-CZ', 'ro-RO', 'hu-HU', 'el-GR',
  'he-IL', 'ar-AE', 'ar-SA', 'id-ID', 'th-TH', 'vi-VN', 'en-IN', 'en-SG'
]
