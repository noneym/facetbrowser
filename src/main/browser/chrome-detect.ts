import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import type { Settings } from '@shared/types'

export interface BrowserInfo {
  found: boolean
  path: string
  version: string
  channel: 'chrome' | 'msedge' | 'custom'
}

const WIN_CANDIDATES: Array<[string, 'chrome' | 'msedge']> = [
  [path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'), 'chrome'],
  [path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'), 'chrome'],
  [path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'), 'chrome'],
  [path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'msedge'],
  [path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'msedge']
]
const MAC_CANDIDATES: Array<[string, 'chrome' | 'msedge']> = [
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'chrome'],
  ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'msedge']
]
const LINUX_CANDIDATES: Array<[string, 'chrome' | 'msedge']> = [
  ['/usr/bin/google-chrome', 'chrome'],
  ['/usr/bin/google-chrome-stable', 'chrome'],
  ['/usr/bin/chromium', 'chrome'],
  ['/usr/bin/chromium-browser', 'chrome'],
  ['/usr/bin/microsoft-edge', 'msedge']
]

const versionCache = new Map<string, string>()

function versionFromInstall(exe: string): string {
  const cached = versionCache.get(exe)
  if (cached) return cached
  const v = readVersion(exe)
  if (v) versionCache.set(exe, v)
  return v
}

function readVersion(exe: string): string {
  try {
    if (process.platform === 'win32') {
      // The exe's own version is what actually runs; a newer version folder
      // may already be staged next to it waiting for a restart.
      try {
        const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { timeout: 8000, windowsHide: true }).toString().trim()
        if (/^\d+\.\d+\.\d+\.\d+$/.test(out)) return out
      } catch {
        /* fall back to folder listing */
      }
      const dir = path.dirname(exe)
      const versions = fs.readdirSync(dir).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d))
      if (versions.length) return versions.sort((a, b) => cmpVer(b, a))[0]
    } else if (process.platform === 'darwin') {
      const fw = path.join(path.dirname(path.dirname(exe)), 'Frameworks')
      for (const f of fs.readdirSync(fw)) {
        const vdir = path.join(fw, f, 'Versions')
        if (fs.existsSync(vdir)) {
          const versions = fs.readdirSync(vdir).filter((d) => /^\d+\.\d+/.test(d))
          if (versions.length) return versions.sort((a, b) => cmpVer(b, a))[0]
        }
      }
    } else {
      const out = execFileSync(exe, ['--version'], { timeout: 5000 }).toString()
      const m = out.match(/(\d+\.\d+\.\d+\.\d+)/)
      if (m) return m[1]
    }
  } catch {
    /* ignore */
  }
  return ''
}

function cmpVer(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

export function detectBrowser(settings: Settings): BrowserInfo {
  if (settings.browserChannel === 'custom' && settings.browserPath && fs.existsSync(settings.browserPath)) {
    return { found: true, path: settings.browserPath, version: versionFromInstall(settings.browserPath), channel: 'custom' }
  }
  const candidates = process.platform === 'win32' ? WIN_CANDIDATES : process.platform === 'darwin' ? MAC_CANDIDATES : LINUX_CANDIDATES
  const preferred = candidates.filter(([, ch]) => ch === settings.browserChannel)
  const rest = candidates.filter(([, ch]) => ch !== settings.browserChannel)
  for (const [p, ch] of [...preferred, ...rest]) {
    if (fs.existsSync(p)) return { found: true, path: p, version: versionFromInstall(p), channel: ch }
  }
  return { found: false, path: '', version: '', channel: settings.browserChannel }
}
