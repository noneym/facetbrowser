import { app } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { EventEmitter } from 'events'
import type { UpdateStatus } from '@shared/types'

const FIRST_CHECK_MS = 20000
const PERIOD_MS = 6 * 3600000

// In-app updates for the NSIS install: latest.yml and the installer live on
// facetbrowser.com/dl (electron-builder's generic provider). Updates are
// downloaded in the background; the user picks when to restart. The portable
// exe cannot replace itself, so it only gets a link.
class Updater extends EventEmitter {
  private st: UpdateStatus = { state: 'idle' }
  private started = false
  private log: (m: string) => void = () => {}

  private get supported(): boolean {
    if (process.platform !== 'win32') return false
    if (process.env['PORTABLE_EXECUTABLE_DIR']) return false
    return app.isPackaged || !!process.env['FACETBROWSER_UPDATE_URL']
  }

  status(): UpdateStatus {
    return this.st
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.st = { ...this.st, ...patch }
    this.emit('status', this.st)
  }

  start(log: (m: string) => void): void {
    if (this.started) return
    this.started = true
    this.log = log
    if (!this.supported) {
      this.set({ state: 'unsupported' })
      return
    }
    const override = process.env['FACETBROWSER_UPDATE_URL']
    if (override) {
      autoUpdater.forceDevUpdateConfig = true
      autoUpdater.setFeedURL({ provider: 'generic', url: override })
    }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false
    autoUpdater.disableWebInstaller = true
    autoUpdater.logger = {
      info: (m: unknown) => this.log(`updater: ${String(m)}`),
      warn: (m: unknown) => this.log(`updater warn: ${String(m)}`),
      error: (m: unknown) => this.log(`updater error: ${String(m)}`),
      debug: () => {}
    }
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info: UpdateInfo) => this.set({ state: 'available', version: info.version, progress: 0 }))
    autoUpdater.on('update-not-available', (info: UpdateInfo) => this.set({ state: 'none', version: info.version, checkedAt: Date.now() }))
    autoUpdater.on('download-progress', (p: { percent: number }) => this.set({ state: 'downloading', progress: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => this.set({ state: 'ready', version: info.version, progress: 100 }))
    autoUpdater.on('error', (e: Error) => this.set({ state: 'error', error: shortError(e) }))
    setTimeout(() => this.check().catch(() => {}), FIRST_CHECK_MS)
    setInterval(() => this.check().catch(() => {}), PERIOD_MS)
  }

  async check(): Promise<UpdateStatus> {
    if (!this.supported || !this.started) return this.st
    if (this.st.state === 'checking' || this.st.state === 'downloading' || this.st.state === 'ready') return this.st
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      this.set({ state: 'error', error: shortError(e as Error) })
    }
    return this.st
  }

  async download(): Promise<UpdateStatus> {
    if (this.st.state !== 'available') return this.st
    try {
      await autoUpdater.downloadUpdate()
    } catch (e) {
      this.set({ state: 'error', error: shortError(e as Error) })
    }
    return this.st
  }

  install(): void {
    if (this.st.state !== 'ready') return
    this.log('updater: quitAndInstall')
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  }
}

// electron-updater errors carry full HTTP dumps and stack traces; keep a
// one-line reason the UI can show next to a retry button.
function shortError(e: Error | undefined): string {
  const m = String(e?.message || e || 'unknown')
  if (/404|Cannot find channel/i.test(m)) return 'not_found'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::ERR_/i.test(m)) return 'offline'
  if (/sha512|checksum/i.test(m)) return 'checksum'
  return m.split('\n')[0].slice(0, 140)
}

export const updater = new Updater()
