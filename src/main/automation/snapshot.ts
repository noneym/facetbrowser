import type { Page } from 'playwright-core'

// Accessibility snapshot with element refs: the agent's main "eye".
//
// Playwright 1.64 does the heavy lifting: `page.ariaSnapshot({ mode: 'ai' })`
// annotates every element with `[ref=eN]` (plus `[cursor=pointer]` for
// clickable ones and `[active]` for the focused one), and `page.getByRef('eN')`
// resolves a ref against the latest snapshot of that frame. This module only
// filters the text (interactive-only view) and parses the lines for `find`.

export interface SnapshotOptions {
  interactiveOnly?: boolean
  depth?: number
  maxChars?: number
  timeoutMs?: number
}

export interface SnapshotResult {
  snapshot: string
  refs: number
  truncated: boolean
  url: string
  title: string
}

export interface SnapshotLine {
  ref: string
  role: string
  name?: string
  line: string
}

const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'slider', 'spinbutton', 'switch', 'tab', 'treeitem', 'menu', 'menubar', 'tablist', 'dialog', 'alertdialog'
])

const LINE_RE = /^(\s*)-\s+([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?(.*)$/
const REF_RE = /\[ref=([a-z0-9]+)\]/

export const DEFAULT_SNAPSHOT_CHARS = 60000

export async function takeSnapshot(page: Page, opts: SnapshotOptions = {}): Promise<SnapshotResult> {
  const raw = await page.ariaSnapshot({ mode: 'ai', depth: opts.depth, timeout: opts.timeoutMs ?? 10000 })
  let text = opts.interactiveOnly ? filterInteractive(raw) : raw
  const refs = (text.match(/\[ref=/g) || []).length
  const max = opts.maxChars ?? DEFAULT_SNAPSHOT_CHARS
  let truncated = false
  if (text.length > max) {
    text = text.slice(0, max) + `\n... (truncated, ${raw.length} chars in total; raise maxChars or pass interactiveOnly)`
    truncated = true
  }
  return { snapshot: text, refs, truncated, url: page.url(), title: await page.title().catch(() => '') }
}

// Keeps the lines that carry a ref and are an interactive role, marked
// clickable, or a heading (the landmarks an agent orients by). Indentation is
// flattened; the full tree is one `interactiveOnly: false` away.
export function filterInteractive(snapshot: string): string {
  const out: string[] = []
  for (const line of snapshot.split('\n')) {
    const m = LINE_RE.exec(line)
    if (!m) continue
    const role = m[2]
    const rest = m[4] || ''
    if (!REF_RE.test(rest)) continue
    if (INTERACTIVE.has(role) || /\[cursor=pointer\]/.test(rest) || role === 'heading') out.push(line.trim().replace(/:$/, ''))
  }
  return out.join('\n')
}

export function parseLines(snapshot: string): SnapshotLine[] {
  const out: SnapshotLine[] = []
  for (const line of snapshot.split('\n')) {
    const m = LINE_RE.exec(line)
    if (!m) continue
    const ref = REF_RE.exec(m[4] || '')?.[1]
    if (!ref) continue
    out.push({ ref, role: m[2], name: m[3] !== undefined ? m[3].replace(/\\"/g, '"') : undefined, line: line.trim().replace(/:$/, '') })
  }
  return out
}

// Text or role match over a fresh snapshot; the agent then acts by ref.
export async function findInPage(page: Page, query: string, limit = 50): Promise<SnapshotLine[]> {
  const raw = await page.ariaSnapshot({ mode: 'ai', timeout: 10000 })
  const q = query.trim().toLowerCase()
  if (!q) return []
  const lines = parseLines(raw)
  const exact = lines.filter((l) => l.role === q || (l.name && l.name.toLowerCase() === q))
  const partial = lines.filter((l) => !exact.includes(l) && l.line.toLowerCase().includes(q))
  return [...exact, ...partial].slice(0, limit)
}
