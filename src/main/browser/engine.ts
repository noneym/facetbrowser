import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { execFileSync } from 'child_process'

// The FacetBrowser Engine: a fingerprint-chromium build (BSD-3-Clause,
// github.com/adryfish/fingerprint-chromium) that spoofs canvas, WebGL, audio,
// fonts, hardware and UA at the C++ level and reports navigator.webdriver=false.
// Builds are hosted on facetbrowser.com; this module downloads, verifies and
// extracts them under the user data folder.

export interface EngineRelease {
  version: string // Chromium version, e.g. 148.0.7778.215
  file: string
  url: string
  mirror?: string
  sha256?: string
  platform: 'win32'
  arch: 'x64'
}

export interface EngineStatus {
  supported: boolean // only Windows x64 builds exist today
  installed: boolean
  installedVersion: string | null
  exePath: string | null
  latest: EngineRelease | null
  downloading: boolean
  progress: number // 0..1
  error: string | null
}

// Primary URL is the upstream GitHub release (official channel); `mirror` is
// tried first when set and falls back to the primary on failure.
export const KNOWN_RELEASES: EngineRelease[] = [
  {
    version: '148.0.7778.215',
    file: 'ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip',
    url: 'https://github.com/adryfish/fingerprint-chromium/releases/download/148.0.7778.215/ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip',
    mirror: 'https://facetbrowser.com/dl/facet-engine-148.0.7778.215-win-x64.zip',
    platform: 'win32',
    arch: 'x64'
  }
]

class EngineManager extends EventEmitter {
  private downloading = false
  private progress = 0
  private error: string | null = null

  get root(): string {
    return path.join(app.getPath('userData'), 'engine')
  }

  private findInstalled(): { version: string; exe: string } | null {
    if (!fs.existsSync(this.root)) return null
    const versions = fs.readdirSync(this.root).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d))
    const found = versions
      .map((v) => ({ version: v, exe: findChrome(path.join(this.root, v)) }))
      .filter((x): x is { version: string; exe: string } => !!x.exe)
      .sort((a, b) => cmpVer(b.version, a.version))
    return found[0] || null
  }

  latest(): EngineRelease | null {
    return process.platform === 'win32' && process.arch === 'x64' ? KNOWN_RELEASES[KNOWN_RELEASES.length - 1] : null
  }

  status(): EngineStatus {
    const inst = this.findInstalled()
    return {
      supported: process.platform === 'win32' && process.arch === 'x64',
      installed: !!inst,
      installedVersion: inst?.version || null,
      exePath: inst?.exe || null,
      latest: this.latest(),
      downloading: this.downloading,
      progress: this.progress,
      error: this.error
    }
  }

  exePath(): string | null {
    return this.findInstalled()?.exe || null
  }

  private emitStatus(): void {
    this.emit('status', this.status())
  }

  async install(release?: EngineRelease): Promise<EngineStatus> {
    const rel = release || this.latest()
    if (!rel) throw new Error('No engine build for this platform yet')
    if (this.downloading) return this.status()
    this.downloading = true
    this.progress = 0
    this.error = null
    this.emitStatus()
    const target = path.join(this.root, rel.version)
    const tmpZip = path.join(this.root, `${rel.file}.part`)
    try {
      fs.mkdirSync(this.root, { recursive: true })
      let res: Response | null = null
      for (const url of [rel.mirror, rel.url].filter((u): u is string => !!u)) {
        try {
          const r = await fetch(url, { redirect: 'follow' })
          if (r.ok && r.body) { res = r; break }
        } catch {
          /* try next source */
        }
      }
      if (!res || !res.body) throw new Error('Download failed from every source')
      const total = Number(res.headers.get('content-length') || 0)
      let seen = 0
      const hash = createHash('sha256')
      const out = fs.createWriteStream(tmpZip)
      const reader = res.body.getReader()
      let lastEmit = 0
      await new Promise<void>((resolve, reject) => {
        const pump = (): void => {
          reader.read().then(({ done, value }) => {
            if (done) { out.end(); return }
            hash.update(value)
            seen += value.length
            if (total && Date.now() - lastEmit > 300) { this.progress = Math.min(0.95, seen / total); lastEmit = Date.now(); this.emitStatus() }
            if (!out.write(value)) out.once('drain', pump)
            else pump()
          }).catch(reject)
        }
        out.on('finish', resolve)
        out.on('error', reject)
        pump()
      })
      const digest = hash.digest('hex')
      if (rel.sha256 && digest !== rel.sha256) throw new Error('Checksum mismatch; download corrupted')
      this.progress = 0.96
      this.emitStatus()
      fs.rmSync(target, { recursive: true, force: true })
      await extractZip(tmpZip, target)
      fs.unlinkSync(tmpZip)
      if (!findChrome(target)) throw new Error('Archive did not contain chrome.exe')
      this.progress = 1
      return this.status()
    } catch (e) {
      this.error = (e as Error).message
      try { fs.unlinkSync(tmpZip) } catch { /* ignore */ }
      throw e
    } finally {
      this.downloading = false
      this.emitStatus()
    }
  }

  remove(): void {
    fs.rmSync(this.root, { recursive: true, force: true })
    this.emitStatus()
  }
}

function findChrome(dir: string): string | null {
  if (!fs.existsSync(dir)) return null
  const direct = path.join(dir, 'chrome.exe')
  if (fs.existsSync(direct)) return direct
  for (const sub of fs.readdirSync(dir)) {
    const p = path.join(dir, sub, 'chrome.exe')
    if (fs.existsSync(p)) return p
  }
  return null
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

// Windows ships tar.exe (bsdtar) which understands zip; avoids a native dependency.
async function extractZip(zip: string, dest: string): Promise<void> {
  fs.mkdirSync(dest, { recursive: true })
  const tar = process.platform === 'win32' ? path.join(process.env['SystemRoot'] || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  execFileSync(tar, ['-xf', zip, '-C', dest], { stdio: 'ignore', windowsHide: true, maxBuffer: 1024 * 1024 })
}

export const engine = new EngineManager()
