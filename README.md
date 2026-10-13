# FacetBrowser

Multi-profile anti-detect browser with built-in proxy quality analysis. Each profile is an isolated Chromium instance with its own fingerprint, proxy, cookies and storage.

Website: [facetbrowser.com](https://facetbrowser.com)

## Features

**Profiles**
- Unlimited isolated profiles, each with its own user data directory (cookies, localStorage, sessions, extensions)
- Clone a profile 1-50 times, with a fresh fingerprint per copy or the same device identity
- Tags, groups, favourites, notes, search and bulk actions (launch, stop, export, delete)
- Import / export profiles as JSON, import / export cookies (Playwright JSON, EditThisCookie, Netscape cookies.txt)
- Start pages and unpacked extensions per profile

**Fingerprint**
- Consistent generator: OS, user agent, platform, screen, pixel ratio, GPU (WebGL vendor / renderer), CPU cores, memory, touch points, languages, locale
- Seeded noise for Canvas, WebGL, AudioContext and ClientRects: stable for one profile, different across profiles
- WebRTC: altered (hides real IP, keeps proxy IP), disabled or real
- Timezone and geolocation taken from the proxy automatically, or set by hand
- Font list masked per operating system, media device counts, battery masking, Do Not Track
- UA version is synced to the installed Chrome at launch, so client hints never contradict the UA string
- `navigator.webdriver` false, no automation banner, native-looking overrides (`toString` returns `[native code]`)
- Launch flags are kept to the bare minimum (no `--no-sandbox`, none of Playwright's `--disable-features` list; `--test-type` keeps Chrome from showing the command-line warning bar). When the profile OS equals the host OS, Chrome sends its own user agent and client hints untouched; language comes from the profile preferences. Cross-OS profiles use a CDP user agent override and are less stealthy.

**Account and cloud sync** (backed by [FacetBrowser-web](https://github.com/noneym/FacetBrowser-web))
- Sign in or register inside the app; 14-day trial, lifetime Starter (15 profiles) and Unlimited licenses
- Profiles, proxies and groups sync between machines (last-write-wins, deletions propagate)
- Cookie jars are uploaded while a profile runs and on stop, and pulled before launch when another machine saved a newer one
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

## Development

Requirements: Node 20+, Google Chrome or Microsoft Edge installed (or any Chromium build via Settings > Custom path).

```bash
npm install
npm run dev
```

Build and package for Windows:

```bash
npm run dist            # NSIS installer + portable exe in release/
npm run dist:portable   # portable exe only
```

Typecheck:

```bash
npm run typecheck
```

## How it works

- `src/main/browser/launcher.ts` starts a Chromium persistent context per profile via `playwright-core` and injects `src/main/browser/fingerprint-script.ts` into every frame before page scripts run.
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
