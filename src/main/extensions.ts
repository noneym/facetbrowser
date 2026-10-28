import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import type { InstalledExtension, Profile } from '@shared/types'
import { parseWebStoreId } from '@shared/extensions'
import { store } from './store'
import { engine } from './browser/engine'
import { launcher } from './browser/launcher'

// Chrome Web Store extensions for profiles. The CRX is fetched from Google's
// update service (same URL Chrome itself uses), unpacked under
// <userData>/extensions/<id> and loaded with --load-extension at launch. Each
// profile still has its own extension storage, so a password manager is
// signed in per profile.
class ExtensionManager {
  get root(): string {
    return path.join(app.getPath('userData'), 'extensions')
  }

  list(): InstalledExtension[] {
    return store().extensions.filter((e) => fs.existsSync(path.join(e.dir, 'manifest.json')))
  }

  dirsFor(profile: Profile): string[] {
    const picked = new Set(profile.extensionIds || [])
    return this.list().filter((e) => e.enabledForAll || picked.has(e.id)).map((e) => e.dir)
  }

  async install(input: string): Promise<InstalledExtension> {
    const id = parseWebStoreId(input)
    if (!id) throw new Error('bad_extension_id')
    const chromeVersion = engine.status().installedVersion || '148.0.0.0'
    const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${chromeVersion}&acceptformat=crx2,crx3&x=id%3D${id}%26installsource%3Dondemand%26uc`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 180000)
    let buf: Buffer
    try {
      const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal })
      if (!res.ok) throw new Error(res.status === 404 ? 'extension_not_found' : `download_failed_${res.status}`)
      buf = Buffer.from(await res.arrayBuffer())
    } finally {
      clearTimeout(timer)
    }
    const { zip, keys } = parseCrx(buf)
    fs.mkdirSync(this.root, { recursive: true })
    const tmpZip = path.join(this.root, `${id}.zip.part`)
    const tmpDir = path.join(this.root, `${id}.tmp`)
    const dir = path.join(this.root, id)
    fs.writeFileSync(tmpZip, zip)
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.mkdirSync(tmpDir, { recursive: true })
    try {
      const tar = process.platform === 'win32' ? path.join(process.env['SystemRoot'] || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
      try {
        execFileSync(tar, ['-xf', tmpZip, '-C', tmpDir], { stdio: 'ignore', windowsHide: true })
      } catch (e) {
        // Some store packages carry entries with empty names; bsdtar skips
        // them and exits non-zero even though everything else was written.
        if (!fs.existsSync(path.join(tmpDir, 'manifest.json'))) throw e
      }
    } finally {
      try { fs.unlinkSync(tmpZip) } catch { /* ignore */ }
    }
    // Unpacked extensions get an id derived from their folder path unless the
    // manifest carries the publisher's public key. Write the key whose hash
    // is the Web Store id, so the extension keeps its real id (OAuth redirect
    // URLs and sites that check the id keep working).
    const key = keys.find((k) => idOfKey(k) === id)
    if (key) {
      try {
        const mf = path.join(tmpDir, 'manifest.json')
        const m = JSON.parse(fs.readFileSync(mf, 'utf8')) as Record<string, unknown>
        if (!m['key']) {
          m['key'] = key.toString('base64')
          fs.writeFileSync(mf, JSON.stringify(m, null, 2))
        }
      } catch { /* keep as is */ }
    }
    const meta = readManifest(tmpDir)
    if (!meta) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      throw new Error('bad_extension_package')
    }
    fs.rmSync(dir, { recursive: true, force: true })
    fs.renameSync(tmpDir, dir)
    const prev = store().extensions.find((e) => e.id === id)
    const rec: InstalledExtension = { id, name: meta.name, version: meta.version, dir, icon: meta.icon, enabledForAll: prev ? prev.enabledForAll : true, installedAt: Date.now() }
    store().upsertExtension(rec)
    return rec
  }

  remove(id: string): void {
    const dir = path.join(this.root, id)
    fs.rmSync(dir, { recursive: true, force: true })
    store().deleteExtension(id)
  }

  // Folders under <profile>/Default that hold one extension's own state:
  // chrome.storage (local/sync/managed), IndexedDB and the newer per-extension
  // storage partition. Copying them while both profiles are closed moves that
  // extension's sign-in/settings to another profile. Only these folders are
  // touched: cookies, site data and everything else stay per profile.
  private dataDirs(profileDir: string, id: string): string[] {
    const d = path.join(profileDir, 'Default')
    const out = [
      path.join(d, 'Local Extension Settings', id),
      path.join(d, 'Sync Extension Settings', id),
      path.join(d, 'Managed Extension Settings', id),
      path.join(d, 'IndexedDB', `chrome-extension_${id}_0.indexeddb.leveldb`),
      path.join(d, 'IndexedDB', `chrome-extension_${id}_0.indexeddb.blob`),
      path.join(d, 'Storage', 'ext', id)
    ]
    return out
  }

  hasData(profile: Profile, id: string): boolean {
    const dir = launcher.userDataDir(profile, store().settings)
    return this.dataDirs(dir, id).some((p) => fs.existsSync(p))
  }

  dataProfiles(id: string): string[] {
    return store().profiles.filter((p) => this.hasData(p, id)).map((p) => p.id)
  }

  copyData(id: string, fromProfileId: string, toProfileIds: string[]): { copied: string[]; skippedRunning: string[]; missing: string[] } {
    const s = store()
    const from = s.getProfile(fromProfileId)
    if (!from) throw new Error('profile_not_found')
    if (launcher.isRunning(from.id)) throw new Error('source_running')
    const fromDir = launcher.userDataDir(from, s.settings)
    const sources = this.dataDirs(fromDir, id).filter((p) => fs.existsSync(p))
    if (!sources.length) throw new Error('no_extension_data')
    const copied: string[] = []
    const skippedRunning: string[] = []
    const missing: string[] = []
    for (const toId of toProfileIds) {
      if (toId === from.id) continue
      const to = s.getProfile(toId)
      if (!to) { missing.push(toId); continue }
      if (launcher.isRunning(to.id)) { skippedRunning.push(to.id); continue }
      const toDir = launcher.userDataDir(to, s.settings)
      const targets = this.dataDirs(toDir, id)
      for (const t of targets) fs.rmSync(t, { recursive: true, force: true })
      for (const src of sources) {
        const rel = path.relative(fromDir, src)
        const dst = path.join(toDir, rel)
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.cpSync(src, dst, { recursive: true, filter: (p) => !/LOCK$/.test(p) })
      }
      copied.push(to.id)
    }
    return { copied, skippedRunning, missing }
  }

  setAll(id: string, enabledForAll: boolean): InstalledExtension[] {
    const e = store().extensions.find((x) => x.id === id)
    if (e) store().upsertExtension({ ...e, enabledForAll })
    return this.list()
  }
}

// CRX2: magic, version, key length, signature length, key, signature, zip.
// CRX3: magic, version, header length, header (protobuf CrxFileHeader with the
// publisher's public keys), zip.
function parseCrx(buf: Buffer): { zip: Buffer; keys: Buffer[] } {
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error('bad_extension_package')
  const version = buf.readUInt32LE(4)
  if (version === 2) {
    const key = buf.readUInt32LE(8)
    const sig = buf.readUInt32LE(12)
    return { zip: buf.subarray(16 + key + sig), keys: [buf.subarray(16, 16 + key)] }
  }
  if (version === 3) {
    const len = buf.readUInt32LE(8)
    const header = buf.subarray(12, 12 + len)
    return { zip: buf.subarray(12 + len), keys: crx3PublicKeys(header) }
  }
  throw new Error('bad_extension_package')
}

// Minimal protobuf walk: CrxFileHeader.sha256_with_rsa (2) and
// sha256_with_ecdsa (3) are AsymmetricKeyProof { public_key = 1 }.
function crx3PublicKeys(header: Buffer): Buffer[] {
  const keys: Buffer[] = []
  for (const [field, value] of protoFields(header)) {
    if ((field === 2 || field === 3) && Buffer.isBuffer(value)) {
      for (const [f2, v2] of protoFields(value)) if (f2 === 1 && Buffer.isBuffer(v2)) keys.push(v2)
    }
  }
  return keys
}

function* protoFields(b: Buffer): Generator<[number, Buffer | number]> {
  let i = 0
  const varint = (): number => {
    let r = 0
    let shift = 0
    while (i < b.length) {
      const byte = b[i++]
      r += (byte & 0x7f) * 2 ** shift
      shift += 7
      if (!(byte & 0x80)) break
    }
    return r
  }
  while (i < b.length) {
    const tag = varint()
    const field = Math.floor(tag / 8)
    const wire = tag % 8
    if (wire === 0) yield [field, varint()]
    else if (wire === 2) {
      const len = varint()
      yield [field, b.subarray(i, i + len)]
      i += len
    } else if (wire === 1) i += 8
    else if (wire === 5) i += 4
    else break
  }
}

// Web Store id: first 16 bytes of sha256(public key DER), each nibble as a-p.
function idOfKey(key: Buffer): string {
  return [...createHash('sha256').update(key).digest().subarray(0, 16)].map((byte) => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15))).join('')
}

function readManifest(dir: string): { name: string; version: string; icon?: string } | null {
  const file = path.join(dir, 'manifest.json')
  if (!fs.existsSync(file)) return null
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: string; version?: string; default_locale?: string; icons?: Record<string, string> }
    let name = String(m.name || 'Extension')
    const msg = name.match(/^__MSG_(.+)__$/)
    if (msg && m.default_locale) {
      const loc = path.join(dir, '_locales', m.default_locale, 'messages.json')
      try {
        const messages = JSON.parse(fs.readFileSync(loc, 'utf8')) as Record<string, { message?: string }>
        name = messages[msg[1]]?.message || name
      } catch { /* keep raw */ }
    }
    let icon: string | undefined
    if (m.icons) {
      const best = Object.keys(m.icons).map(Number).filter((n) => n <= 128).sort((a, b) => b - a)[0]
      const rel = best ? m.icons[String(best)] : undefined
      if (rel) {
        const p = path.join(dir, rel.replace(/^\//, ''))
        if (fs.existsSync(p) && fs.statSync(p).size < 300000) {
          const mime = p.endsWith('.svg') ? 'image/svg+xml' : p.endsWith('.jpg') || p.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
          icon = `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`
        }
      }
    }
    return { name, version: String(m.version || ''), icon }
  } catch {
    return null
  }
}

export const extensions = new ExtensionManager()
