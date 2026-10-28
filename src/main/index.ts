import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import path from 'path'
import fs from 'fs'
import { registerIpc } from './ipc'
import { launcher } from './browser/launcher'
import { store } from './store'
import { sync } from './cloud/sync'

// Fixed data location regardless of how the app is started (packaged, `electron .`, or test harness).
app.setPath('userData', process.env['FACETBROWSER_DATA_DIR'] || path.join(app.getPath('appData'), 'FacetBrowser'))

let mainWindow: BrowserWindow | null = null

// Startup diagnostics: %APPDATA%/FacetBrowser/logs/main.log
function log(msg: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'main.log'), `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* ignore */
  }
}
process.on('uncaughtException', (e) => log(`uncaughtException ${e.stack || e.message}`))
process.on('unhandledRejection', (e) => log(`unhandledRejection ${(e as Error)?.stack || String(e)}`))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32' ? { color: '#0b0d10', symbolColor: '#9aa3ad', height: 40 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  // Show as soon as anything is ready. 'ready-to-show' (first paint) never fires
  // in the packaged Windows build on some machines, which left the window
  // created but invisible; the single-instance lock then made every later
  // launch exit immediately. So we take the earliest of: first paint, DOM
  // loaded, or a 3 s watchdog. backgroundColor avoids a white flash.
  const started = Date.now()
  const reveal = (why: string): void => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return
    log(`show window (${why}, +${Date.now() - started}ms)`)
    mainWindow.show()
  }
  mainWindow.on('ready-to-show', () => reveal('ready-to-show'))
  mainWindow.webContents.once('dom-ready', () => reveal('dom-ready'))
  setTimeout(() => reveal('watchdog'), 3000)
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => log(`did-fail-load ${code} ${desc} ${url}`))
  mainWindow.webContents.on('render-process-gone', (_e, details) => log(`render-process-gone ${details.reason} exit=${details.exitCode}`))
  mainWindow.webContents.on('console-message', (_e, level, message) => { if (level >= 2) log(`renderer[${level}] ${message}`) })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark'
    store()
    registerIpc()
    createWindow()
    if (store().cloud.session) sync.start()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (e) => {
  if (launcher.list().length) {
    e.preventDefault()
    await launcher.stopAll()
    store().flush()
    app.exit(0)
  } else {
    store().flush()
  }
})
