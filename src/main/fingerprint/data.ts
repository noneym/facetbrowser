// Pools of realistic fingerprint building blocks. Values are combined by the
// generator so that OS, user agent, screen and GPU stay mutually consistent.

export const WINDOWS_GPUS: Array<[string, string]> = [
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER (0x000021C4) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x000025A2) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti (0x00001C82) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 580 Series (0x000067DF) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) HD Graphics 620 (0x00005916) Direct3D11 vs_5_0 ps_5_0, D3D11)']
]

export const MAC_GPUS: Array<[string, string]> = [
  ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'],
  ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'],
  ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)'],
  ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)'],
  ['Google Inc. (Intel Inc.)', 'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon Pro 5500M OpenGL Engine, OpenGL 4.1)']
]

export const LINUX_GPUS: Array<[string, string]> = [
  ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6 (Core Profile) Mesa 23.2.1)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6700 XT (navi22, LLVM 15.0.7, DRM 3.54, 6.5.0-28-generic), OpenGL 4.6)'],
  ['Google Inc. (NVIDIA Corporation)', 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3070/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 535.171.04)'],
  ['Google Inc. (Mesa)', 'ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5 (Core Profile) Mesa 23.2.1)']
]

export const ANDROID_GPUS: Array<[string, string]> = [
  ['Qualcomm', 'Adreno (TM) 740'],
  ['Qualcomm', 'Adreno (TM) 650'],
  ['ARM', 'Mali-G78'],
  ['ARM', 'Mali-G710'],
  ['Samsung Electronics Co., Ltd.', 'Samsung Xclipse 920']
]

export const WINDOWS_SCREENS: Array<[number, number, number]> = [
  [1920, 1080, 1], [1920, 1080, 1], [1920, 1080, 1.25], [2560, 1440, 1], [1366, 768, 1],
  [1536, 864, 1.25], [1440, 900, 1], [1600, 900, 1], [1680, 1050, 1], [2560, 1080, 1],
  [3840, 2160, 1.5], [1280, 720, 1], [1920, 1200, 1]
]
export const MAC_SCREENS: Array<[number, number, number]> = [
  [1440, 900, 2], [1512, 982, 2], [1728, 1117, 2], [1680, 1050, 2], [2560, 1440, 2], [1920, 1080, 2], [2560, 1600, 2]
]
export const LINUX_SCREENS: Array<[number, number, number]> = [
  [1920, 1080, 1], [2560, 1440, 1], [1366, 768, 1], [1600, 900, 1], [3840, 2160, 2]
]
export const ANDROID_SCREENS: Array<[number, number, number]> = [
  [412, 915, 2.625], [393, 873, 2.75], [360, 800, 3], [384, 854, 2.8125], [412, 892, 3.5]
]

export const ANDROID_DEVICES: Array<[string, string]> = [
  ['SM-S918B', '14'], ['SM-A546B', '14'], ['Pixel 8', '14'], ['Pixel 7a', '14'], ['SM-G991B', '13'],
  ['M2101K6G', '13'], ['CPH2449', '14'], ['SM-S911B', '14'], ['2201116SG', '13']
]

export const WINDOWS_CORES = [4, 4, 6, 8, 8, 8, 12, 16]
export const MAC_CORES = [8, 8, 10, 12]
export const LINUX_CORES = [4, 8, 8, 12, 16]
export const ANDROID_CORES = [8, 8, 8]
export const MEMORY_CHOICES = [4, 8, 8, 8, 16, 16, 32]

export const LOCALES: Array<{ locale: string; languages: string[]; timezones: string[] }> = [
  { locale: 'en-US', languages: ['en-US', 'en'], timezones: ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Denver'] },
  { locale: 'en-GB', languages: ['en-GB', 'en'], timezones: ['Europe/London'] },
  { locale: 'de-DE', languages: ['de-DE', 'de', 'en'], timezones: ['Europe/Berlin'] },
  { locale: 'fr-FR', languages: ['fr-FR', 'fr', 'en'], timezones: ['Europe/Paris'] },
  { locale: 'tr-TR', languages: ['tr-TR', 'tr', 'en'], timezones: ['Europe/Istanbul'] },
  { locale: 'es-ES', languages: ['es-ES', 'es', 'en'], timezones: ['Europe/Madrid'] },
  { locale: 'it-IT', languages: ['it-IT', 'it', 'en'], timezones: ['Europe/Rome'] },
  { locale: 'nl-NL', languages: ['nl-NL', 'nl', 'en'], timezones: ['Europe/Amsterdam'] },
  { locale: 'pl-PL', languages: ['pl-PL', 'pl', 'en'], timezones: ['Europe/Warsaw'] },
  { locale: 'pt-BR', languages: ['pt-BR', 'pt', 'en'], timezones: ['America/Sao_Paulo'] },
  { locale: 'ru-RU', languages: ['ru-RU', 'ru', 'en'], timezones: ['Europe/Moscow'] },
  { locale: 'ja-JP', languages: ['ja-JP', 'ja', 'en'], timezones: ['Asia/Tokyo'] },
  { locale: 'en-CA', languages: ['en-CA', 'en', 'fr'], timezones: ['America/Toronto', 'America/Vancouver'] },
  { locale: 'en-AU', languages: ['en-AU', 'en'], timezones: ['Australia/Sydney', 'Australia/Melbourne'] }
]

// Country code -> locale + languages, used when adapting a profile to a proxy.
export const COUNTRY_LOCALES: Record<string, { locale: string; languages: string[] }> = {
  US: { locale: 'en-US', languages: ['en-US', 'en'] },
  GB: { locale: 'en-GB', languages: ['en-GB', 'en'] },
  CA: { locale: 'en-CA', languages: ['en-CA', 'en', 'fr'] },
  AU: { locale: 'en-AU', languages: ['en-AU', 'en'] },
  DE: { locale: 'de-DE', languages: ['de-DE', 'de', 'en'] },
  AT: { locale: 'de-AT', languages: ['de-AT', 'de', 'en'] },
  CH: { locale: 'de-CH', languages: ['de-CH', 'de', 'fr', 'en'] },
  FR: { locale: 'fr-FR', languages: ['fr-FR', 'fr', 'en'] },
  TR: { locale: 'tr-TR', languages: ['tr-TR', 'tr', 'en'] },
  ES: { locale: 'es-ES', languages: ['es-ES', 'es', 'en'] },
  MX: { locale: 'es-MX', languages: ['es-MX', 'es', 'en'] },
  IT: { locale: 'it-IT', languages: ['it-IT', 'it', 'en'] },
  NL: { locale: 'nl-NL', languages: ['nl-NL', 'nl', 'en'] },
  BE: { locale: 'nl-BE', languages: ['nl-BE', 'nl', 'fr', 'en'] },
  PL: { locale: 'pl-PL', languages: ['pl-PL', 'pl', 'en'] },
  BR: { locale: 'pt-BR', languages: ['pt-BR', 'pt', 'en'] },
  PT: { locale: 'pt-PT', languages: ['pt-PT', 'pt', 'en'] },
  RU: { locale: 'ru-RU', languages: ['ru-RU', 'ru', 'en'] },
  UA: { locale: 'uk-UA', languages: ['uk-UA', 'uk', 'ru', 'en'] },
  JP: { locale: 'ja-JP', languages: ['ja-JP', 'ja', 'en'] },
  KR: { locale: 'ko-KR', languages: ['ko-KR', 'ko', 'en'] },
  CN: { locale: 'zh-CN', languages: ['zh-CN', 'zh', 'en'] },
  TW: { locale: 'zh-TW', languages: ['zh-TW', 'zh', 'en'] },
  HK: { locale: 'zh-HK', languages: ['zh-HK', 'zh', 'en'] },
  IN: { locale: 'en-IN', languages: ['en-IN', 'en', 'hi'] },
  SE: { locale: 'sv-SE', languages: ['sv-SE', 'sv', 'en'] },
  NO: { locale: 'nb-NO', languages: ['nb-NO', 'nb', 'en'] },
  DK: { locale: 'da-DK', languages: ['da-DK', 'da', 'en'] },
  FI: { locale: 'fi-FI', languages: ['fi-FI', 'fi', 'en'] },
  CZ: { locale: 'cs-CZ', languages: ['cs-CZ', 'cs', 'en'] },
  RO: { locale: 'ro-RO', languages: ['ro-RO', 'ro', 'en'] },
  HU: { locale: 'hu-HU', languages: ['hu-HU', 'hu', 'en'] },
  GR: { locale: 'el-GR', languages: ['el-GR', 'el', 'en'] },
  IL: { locale: 'he-IL', languages: ['he-IL', 'he', 'en'] },
  AE: { locale: 'ar-AE', languages: ['ar-AE', 'ar', 'en'] },
  SA: { locale: 'ar-SA', languages: ['ar-SA', 'ar', 'en'] },
  EG: { locale: 'ar-EG', languages: ['ar-EG', 'ar', 'en'] },
  ID: { locale: 'id-ID', languages: ['id-ID', 'id', 'en'] },
  TH: { locale: 'th-TH', languages: ['th-TH', 'th', 'en'] },
  VN: { locale: 'vi-VN', languages: ['vi-VN', 'vi', 'en'] },
  SG: { locale: 'en-SG', languages: ['en-SG', 'en', 'zh'] },
  MY: { locale: 'ms-MY', languages: ['ms-MY', 'ms', 'en'] },
  PH: { locale: 'en-PH', languages: ['en-PH', 'en', 'fil'] },
  ZA: { locale: 'en-ZA', languages: ['en-ZA', 'en'] },
  NG: { locale: 'en-NG', languages: ['en-NG', 'en'] },
  AR: { locale: 'es-AR', languages: ['es-AR', 'es', 'en'] },
  CL: { locale: 'es-CL', languages: ['es-CL', 'es', 'en'] },
  CO: { locale: 'es-CO', languages: ['es-CO', 'es', 'en'] },
  IE: { locale: 'en-IE', languages: ['en-IE', 'en'] },
  NZ: { locale: 'en-NZ', languages: ['en-NZ', 'en'] },
  MD: { locale: 'ro-RO', languages: ['ro-RO', 'ro', 'ru', 'en'] },
  BG: { locale: 'bg-BG', languages: ['bg-BG', 'bg', 'en'] },
  RS: { locale: 'sr-RS', languages: ['sr-RS', 'sr', 'en'] },
  HR: { locale: 'hr-HR', languages: ['hr-HR', 'hr', 'en'] },
  SI: { locale: 'sl-SI', languages: ['sl-SI', 'sl', 'en'] },
  SK: { locale: 'sk-SK', languages: ['sk-SK', 'sk', 'cs', 'en'] },
  LT: { locale: 'lt-LT', languages: ['lt-LT', 'lt', 'en', 'ru'] },
  LV: { locale: 'lv-LV', languages: ['lv-LV', 'lv', 'en', 'ru'] },
  EE: { locale: 'et-EE', languages: ['et-EE', 'et', 'en', 'ru'] },
  BY: { locale: 'ru-BY', languages: ['ru-BY', 'ru', 'be', 'en'] },
  KZ: { locale: 'ru-KZ', languages: ['ru-KZ', 'ru', 'kk', 'en'] },
  GE: { locale: 'ka-GE', languages: ['ka-GE', 'ka', 'ru', 'en'] },
  AM: { locale: 'hy-AM', languages: ['hy-AM', 'hy', 'ru', 'en'] },
  AZ: { locale: 'az-AZ', languages: ['az-AZ', 'az', 'ru', 'en'] },
  UZ: { locale: 'uz-UZ', languages: ['uz-UZ', 'uz', 'ru', 'en'] },
  LU: { locale: 'fr-LU', languages: ['fr-LU', 'fr', 'de', 'en'] },
  IS: { locale: 'is-IS', languages: ['is-IS', 'is', 'en'] },
  CY: { locale: 'el-CY', languages: ['el-CY', 'el', 'en'] },
  MT: { locale: 'en-MT', languages: ['en-MT', 'en', 'mt'] },
  AL: { locale: 'sq-AL', languages: ['sq-AL', 'sq', 'en'] },
  MK: { locale: 'mk-MK', languages: ['mk-MK', 'mk', 'en'] },
  BA: { locale: 'bs-BA', languages: ['bs-BA', 'bs', 'hr', 'sr', 'en'] },
  PE: { locale: 'es-PE', languages: ['es-PE', 'es', 'en'] },
  VE: { locale: 'es-VE', languages: ['es-VE', 'es', 'en'] },
  EC: { locale: 'es-EC', languages: ['es-EC', 'es', 'en'] },
  UY: { locale: 'es-UY', languages: ['es-UY', 'es', 'en'] },
  PY: { locale: 'es-PY', languages: ['es-PY', 'es', 'en'] },
  BO: { locale: 'es-BO', languages: ['es-BO', 'es', 'en'] },
  CR: { locale: 'es-CR', languages: ['es-CR', 'es', 'en'] },
  PA: { locale: 'es-PA', languages: ['es-PA', 'es', 'en'] },
  DO: { locale: 'es-DO', languages: ['es-DO', 'es', 'en'] },
  GT: { locale: 'es-GT', languages: ['es-GT', 'es', 'en'] },
  PK: { locale: 'en-PK', languages: ['en-PK', 'en', 'ur'] },
  BD: { locale: 'bn-BD', languages: ['bn-BD', 'bn', 'en'] },
  LK: { locale: 'en-LK', languages: ['en-LK', 'en', 'si'] },
  NP: { locale: 'ne-NP', languages: ['ne-NP', 'ne', 'en'] },
  IR: { locale: 'fa-IR', languages: ['fa-IR', 'fa', 'en'] },
  IQ: { locale: 'ar-IQ', languages: ['ar-IQ', 'ar', 'en'] },
  JO: { locale: 'ar-JO', languages: ['ar-JO', 'ar', 'en'] },
  KW: { locale: 'ar-KW', languages: ['ar-KW', 'ar', 'en'] },
  QA: { locale: 'ar-QA', languages: ['ar-QA', 'ar', 'en'] },
  OM: { locale: 'ar-OM', languages: ['ar-OM', 'ar', 'en'] },
  BH: { locale: 'ar-BH', languages: ['ar-BH', 'ar', 'en'] },
  LB: { locale: 'ar-LB', languages: ['ar-LB', 'ar', 'fr', 'en'] },
  MA: { locale: 'fr-MA', languages: ['fr-MA', 'fr', 'ar', 'en'] },
  DZ: { locale: 'fr-DZ', languages: ['fr-DZ', 'fr', 'ar', 'en'] },
  TN: { locale: 'fr-TN', languages: ['fr-TN', 'fr', 'ar', 'en'] },
  KE: { locale: 'en-KE', languages: ['en-KE', 'en', 'sw'] },
  GH: { locale: 'en-GH', languages: ['en-GH', 'en'] },
  ET: { locale: 'am-ET', languages: ['am-ET', 'am', 'en'] },
  TZ: { locale: 'sw-TZ', languages: ['sw-TZ', 'sw', 'en'] },
  MM: { locale: 'my-MM', languages: ['my-MM', 'my', 'en'] },
  KH: { locale: 'km-KH', languages: ['km-KH', 'km', 'en'] },
  MN: { locale: 'mn-MN', languages: ['mn-MN', 'mn', 'en'] },
}

export const PROFILE_COLORS = ['#3ecf8e', '#e5a33d', '#5b9cf6', '#e06c75', '#c678dd', '#56b6c2', '#d19a66', '#98c379']
