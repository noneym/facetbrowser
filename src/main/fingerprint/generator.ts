import type { Fingerprint, GenerateFingerprintOptions, OsFamily } from '@shared/types'
import {
  ANDROID_CORES, ANDROID_DEVICES, ANDROID_GPUS, ANDROID_SCREENS, LINUX_CORES, LINUX_GPUS, LINUX_SCREENS,
  LOCALES, MAC_CORES, MAC_GPUS, MAC_SCREENS, MEMORY_CHOICES, WINDOWS_CORES, WINDOWS_GPUS, WINDOWS_SCREENS
} from './data'

// Deterministic PRNG so the same seed always yields the same fingerprint.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rnd: () => number, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)]
}

export function buildUserAgent(os: OsFamily, version: string, rnd: () => number): { ua: string; platform: string } {
  const major = version.split('.')[0]
  // Chrome reduces the UA string: minor/patch are frozen to 0.0.0.
  const frozen = `${major}.0.0.0`
  switch (os) {
    case 'windows':
      return {
        ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${frozen} Safari/537.36`,
        platform: 'Win32'
      }
    case 'macos':
      return {
        ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${frozen} Safari/537.36`,
        platform: 'MacIntel'
      }
    case 'linux':
      return {
        ua: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${frozen} Safari/537.36`,
        platform: 'Linux x86_64'
      }
    case 'android': {
      const [model, androidVersion] = pick(rnd, ANDROID_DEVICES)
      return {
        ua: `Mozilla/5.0 (Linux; Android ${androidVersion}; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${frozen} Mobile Safari/537.36`,
        platform: 'Linux armv81'
      }
    }
  }
}

export function generateFingerprint(opts: GenerateFingerprintOptions = {}): Fingerprint {
  const seed = opts.seed ?? Math.floor(Math.random() * 0xffffffff)
  const rnd = mulberry32(seed)
  // Default to the host OS: a Windows host presenting as macOS is flagged as
  // masking by pixelscan-style checks (fonts, GPU and rendering disagree).
  const hostOs: OsFamily = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : 'windows'
  const os: OsFamily = opts.os ?? hostOs
  const browserVersion = opts.browserVersion ?? '131.0.0.0'
  const { ua, platform } = buildUserAgent(os, browserVersion, rnd)

  const gpus = os === 'windows' ? WINDOWS_GPUS : os === 'macos' ? MAC_GPUS : os === 'linux' ? LINUX_GPUS : ANDROID_GPUS
  const screens = os === 'windows' ? WINDOWS_SCREENS : os === 'macos' ? MAC_SCREENS : os === 'linux' ? LINUX_SCREENS : ANDROID_SCREENS
  const cores = os === 'windows' ? WINDOWS_CORES : os === 'macos' ? MAC_CORES : os === 'linux' ? LINUX_CORES : ANDROID_CORES
  const [vendor, renderer] = pick(rnd, gpus)
  const [width, height, pixelRatio] = pick(rnd, screens)
  const loc = pick(rnd, LOCALES)

  return {
    seed,
    os,
    browserVersion,
    userAgent: ua,
    platform,
    vendor: 'Google Inc.',
    languages: loc.languages,
    locale: loc.locale,
    timezone: 'auto',
    localeMode: 'auto',
    geolocation: { mode: 'auto' },
    screen: { width, height, colorDepth: 24, pixelRatio },
    hardwareConcurrency: pick(rnd, cores),
    deviceMemory: engineDeviceMemory(seed),
    maxTouchPoints: os === 'android' ? 5 : 0,
    webgl: { vendor, renderer, mode: 'noise' },
    canvas: 'real', // noise is flagged as masking by pixelscan-style checks; WebGL/audio/font noise still separate profiles
    audio: 'noise',
    clientRects: 'noise',
    webrtc: 'altered',
    fonts: 'mask',
    mediaDevices: {
      audioInputs: pick(rnd, [1, 1, 2]),
      audioOutputs: pick(rnd, [1, 1, 2, 3]),
      videoInputs: os === 'android' ? 2 : pick(rnd, [0, 1, 1])
    },
    doNotTrack: null,
    cpuArch: os === 'android' || (os === 'macos' && renderer.includes('Apple M')) ? 'arm' : 'x86',
    batteryMask: true
  }
}

// Re-roll only the noise seed but keep the human-visible identity.
export function reseed(fp: Fingerprint): Fingerprint {
  const seed = Math.floor(Math.random() * 0xffffffff)
  return { ...fp, seed, deviceMemory: engineDeviceMemory(seed) }
}

// The engine derives navigator.deviceMemory from the seed (8, 16 or 32 GB)
// in every context; mirror its formula so the editor shows what pages see.
export function engineDeviceMemory(seed: number): number {
  return [8, 16, 32][(seed % 2147483647) % 3]
}
