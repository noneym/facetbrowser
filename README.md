# FacetBrowser

Multi-profile anti-detect browser with built-in proxy quality analysis. Each profile is an isolated Chromium instance with its own fingerprint, proxy, cookies and storage.

Website: [facetbrowser.com](https://facetbrowser.com)

## Features

**Profiles**
- Unlimited isolated profiles, each with its own user data directory (cookies, localStorage, sessions, extensions). Logins survive closing the profile: session cookies are kept across restarts
- Clone a profile 1-50 times, with a fresh fingerprint per copy or the same device identity
- Tags, groups, favourites, notes, search and bulk actions (launch, stop, export, delete)
- Import / export profiles as JSON, import / export cookies (Playwright JSON, EditThisCookie, Netscape cookies.txt)
- Start pages and unpacked extensions per profile; the tabs open when a profile was closed are reopened on the next launch (Settings > General to turn off)

**FacetBrowser Engine** (Windows x64, macOS on Apple Silicon)
- The only browser the app uses: a Chromium build based on [fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) (BSD-3-Clause) that spoofs canvas, WebGL, audio, fonts, GPU, cores and the user agent at the C++ level and reports `navigator.webdriver` as false, so no JavaScript injection is needed
- Downloaded on demand from Settings (about 190 MB); profiles then launch with `--fingerprint=<seed>`, `--fingerprint-platform`, `--fingerprint-brand=Chrome`, `--timezone` and `--accept-lang` derived from the profile
- Downloaded on first run after sign-in; nothing launches without it. The upstream macOS build is arm64 only, so Intel Macs are not supported

**Fingerprint**
- Consistent generator: OS, user agent, platform, screen, pixel ratio, GPU (WebGL vendor / renderer), CPU cores, memory, touch points, languages, locale
- Seeded noise for Canvas, WebGL, AudioContext and ClientRects: stable for one profile, different across profiles
- WebRTC: altered (hides real IP, keeps proxy IP), disabled or real
- Timezone and geolocation taken from the proxy automatically, or set by hand
- Font list masked per operating system, media device counts, battery masking, Do Not Track
- UA version matches the installed FacetBrowser Engine build, so client hints never contradict the UA string
- `navigator.webdriver` false, no automation banner, native-looking overrides (`toString` returns `[native code]`)
- Launch flags are kept to the bare minimum (no `--no-sandbox`, none of Playwright's `--disable-features` list). The engine applies the user agent, client hints and platform itself from `--fingerprint-platform`, so cross-OS profiles need no CDP override.

**Extensions**
- Install Chrome Web Store extensions from the Extensions page (paste a store link or id, or pick from the featured list: 1Password, Bitwarden, Cookie-Editor, uBlock Origin Lite, MetaMask and more). The CRX is fetched from Google's update service, unpacked under the data folder and loaded in every profile (or only in profiles you pick). The publisher key is written into the manifest so the extension keeps its real Web Store id
- Web Store extensions are pinned to the toolbar in every profile. Each profile has its own extension storage; for 1Password only, "Share sign-in" copies the extension's own store from one closed profile into others on request (nothing else is ever shared between profiles). The desktop 1Password app does not connect to the unsigned engine; the extension works standalone

**Account and cloud sync** (backed by [FacetBrowser-web](https://github.com/noneym/FacetBrowser-web))
- Sign in or register inside the app; 14-day trial, lifetime Starter (15 profiles) and Unlimited licenses
- Profiles, proxies and groups sync between machines (last-write-wins, deletions propagate)
- The session jar (cookies plus localStorage of visited sites) is uploaded while a profile runs and on stop, and pulled before launch when another machine saved a newer one, so logins follow the account between machines
- Offline grace of 7 days on the last confirmed license; server address configurable in Settings

**Proxy providers**
- Connect GonzoProxy (API key, optional proxy login) and 2Captcha Proxy (API key plus gateway credentials) accounts; credentials are stored encrypted in your account
- See balances, generate proxies into the library, or assign one to a profile straight from the editor

**Proxy**
- HTTP, HTTPS, SOCKS4 and SOCKS5 with authentication. Credentials never reach Chromium: a local bridge on 127.0.0.1 opens the upstream connection, so SOCKS5 + password works too
- Proxy library with bulk paste in any common format (`scheme://user:pass@host:port`, `host:port:user:pass`, `user:pass@host:port`, ...)
- One click "match timezone, language and location to proxy"

**Proxy quality check** (ported from [proxy-checker](https://github.com/noneym/proxy-checker) and extended)
- Exit IP, 3-sample latency and jitter, optional bandwidth test (Cloudflare)
- Anonymity level: elite / anonymous / transparent, with the list of leaked headers
- Geo and network data (ip-api): country, city, ISP, ASN, timezone, proxy / hosting / mobile flags
- Fraud signals: getipintel residential proxy probability (`oflags=r`) and AbuseIPDB confidence, reports and Tor flag
- Unified 0-100 quality score with grade A-F and a plain-language list of issues
- Bulk checker page with CSV export and "add usable proxies to library"

**Updates**
- The installer build checks facetbrowser.com for new versions, downloads them in the background and installs on restart (Settings > About). The portable build links to the download page instead.

## Development

Requirements: Node 20+. The app downloads the FacetBrowser Engine on first run (Windows x64, macOS on Apple Silicon).

```bash
npm install
npm run dev
```

Build and package for Windows:

```bash
npm run dist            # NSIS installer + portable exe in release/
npm run dist:portable   # portable exe only
npm run dist:mac        # dmg for Apple Silicon (run on macOS; ad-hoc signed, not notarized)
```

Typecheck:

```bash
npm run typecheck
```

## How it works

- `src/main/browser/launcher.ts` starts a FacetBrowser Engine persistent context per profile via `playwright-core`; `src/main/browser/engine.ts` downloads and verifies the engine build. `src/main/browser/fingerprint-script.ts` only covers what the engine does not (memory cap, battery, media devices, WebRTC policy).
- Startup diagnostics are written to `%APPDATA%/FacetBrowser/logs/main.log`.
- `src/main/proxy/bridge.ts` is the local forwarding proxy that Chromium talks to; it performs HTTP CONNECT or SOCKS handshakes with the real upstream.
- `src/main/proxy/checker.ts` runs the quality pipeline. getipintel calls are rate limited (one every 4.5 s) across the whole app.
- Data lives in `%APPDATA%/FacetBrowser/facetbrowser.json`; profile browser data in `%APPDATA%/FacetBrowser/profiles/<id>`.

## Free API limits

| Source | Limit | Needs |
|---|---|---|
| ip-api.com | 45 req/min | nothing |
| getipintel.net | 500/day, 15/min | an email address |
| AbuseIPDB | 1000/day | free API key |

## License

MIT
