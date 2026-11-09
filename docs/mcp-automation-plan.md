# FacetBrowser Automation API + MCP Server — Plan

Amaç: Claude Code, Cursor, Claude Desktop gibi yapay zeka ajanlarının FacetBrowser
profillerini **tam yetkiyle** sürebilmesi: profil açıp kapatma, sekme yönetimi,
navigasyon, DOM okuma/tıklama/yazma, JavaScript çalıştırma, console ve network
izleme, ekran görüntüsü, cookie/storage, ve ihtiyaç duyan ajanlar için ham CDP
(Chrome DevTools Protocol) erişimi.

Durum: Faz 0 ve Faz 1 tamam (bkz. `docs/automation.md`); sırada Faz 2 (MCP sunucusu). Tahmini efor: 4 faz, toplam 8-12 iş günü.

---

## 1. Mevcut durum (kodun verdiği zemin)

| Konu | Bugün | Plana etkisi |
|---|---|---|
| Profil başlatma | `src/main/browser/launcher.ts` her profil için `chromium.launchPersistentContext` (playwright-core) açar, `--remote-debugging-pipe` ile bağlanır | Canlı `BrowserContext` zaten main process'te elimizde (`launcher.contextOf(id)`). Tüm Playwright API'si (evaluate, route, console, CDP session) kullanılabilir. |
| CDP | Pipe üzerinden yalnızca Playwright konuşur; port açılmıyor | Dış araçlar (chrome-devtools-mcp, Puppeteer) doğrudan bağlanamıyor. Ham CDP istiyorsak ayrıca `--remote-debugging-port` açmak veya CDP'yi Playwright üzerinden köprülemek gerekir. |
| IPC | `ipcMain.handle('browser:launch' …)` 60+ kanal; renderer `window.api` ile konuşur | Aynı iş mantığı (launch, stop, profiles, proxies) API'ye yeniden paketlenecek. Mantık IPC handler'larından bir servis katmanına çekilmeli ki IPC ve HTTP aynı fonksiyonları çağırsın. |
| Anti-detect ilkesi | README: sayfaya hiç JS enjekte edilmiyor, `navigator.webdriver=false` engine'den geliyor | API'nin `evaluate` çağrıları Playwright'ın kendi `Runtime.evaluate`'i ile çağrı anında yapılır; sayfa açılırken init script enjekte edilmez. Tespit yüzeyi değişmez. `--remote-debugging-port` açmak da sayfadan görünmez (localhost'a bağlı). |
| Cloud / plan | `PlanId = trial / starter / unlimited` | API özelliği plan ile kapılanabilir (örn. `unlimited`). Faz 1'de kapı yok; karar sonra. |

---

## 2. Hedef mimari

```
┌──────────────────────┐    stdio (MCP)      ┌───────────────────────────────┐
│ Claude Code / Cursor │◄───────────────────►│ facetbrowser-mcp (npm, ince)  │
│ Claude Desktop       │                      │ sadece HTTP+WS istemcisi      │
└──────────────────────┘                      └──────────────┬────────────────┘
          ▲  Streamable HTTP (MCP)  ┌────────────────────────┼────────────────┐
          └─────────────────────────┤  FacetBrowser (Electron main)           │
                                    │  127.0.0.1:<port>  Bearer token         │
                                    │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
                                    │  │ REST API │ │ WS events│ │ MCP HTTP │ │
                                    │  └────┬─────┘ └────┬─────┘ └────┬─────┘ │
                                    │       └────────────┴────────────┘       │
                                    │            AutomationService            │
                                    │   (Playwright BrowserContext + CDP)     │
                                    │                 launcher                │
                                    └─────────────────────────────────────────┘
                                                   │ per profile
                                      ┌────────────┴──────────────┐
                                      │ FacetBrowser Engine       │
                                      │ --remote-debugging-pipe   │
                                      │ (+ opsiyonel CDP port)    │
                                      └───────────────────────────┘
```

**Neden Electron main içinde?** Canlı `BrowserContext` nesneleri orada. Ayrı bir
process profilin Playwright bağlantısını paylaşamaz (pipe tek sahipli). Bu yüzden
API sunucusu `src/main/automation/` altında, aynı process'te çalışır.

**Neden hem REST/WS hem MCP?** MCP ajanlar için; REST+WS ise script'ler, test
araçları ve ileride web paneli için. İkisi de aynı `AutomationService`'i çağırır,
böylece davranış tek yerde tanımlı olur.

**İnce npm paketi (`facetbrowser-mcp`)** stdio MCP sunucusu olarak çalışır ve
isteklerini yerel HTTP API'ye iletir. Claude Desktop gibi yalnızca stdio
destekleyen istemciler için gerekir. Streamable HTTP destekleyen istemciler
(Claude Code, Cursor) doğrudan `http://127.0.0.1:<port>/mcp` adresine bağlanır.

---

## 3. Bileşenler

### 3.1 `src/main/automation/service.ts` — AutomationService
Tek giriş noktası. IPC'den de HTTP'den de çağrılır. Sorumluluklar:

- Profil yaşam döngüsü: `launch(profileId)`, `stop(profileId)`, `list()` (mevcut
  `browser:*` IPC mantığı buraya taşınır; IPC handler'ları ince sarmalayıcı olur).
- Sekme kayıt defteri: her `Page` için kalıcı `tabId` (`t_xxxx`). Playwright'ın
  Page nesnesi referansla takip edildiği için `WeakMap<Page, string>` +
  `Map<string, Page>` yeterli. `launcher.ts` içindeki `tabs: Map<Page,string>`
  ile birleştirilir.
- Olay yayını: `console`, `pageerror`, `request`/`response`/`requestfailed`,
  `dialog`, `download`, `framenavigated`, `page` (yeni sekme), `close`.
  **Faz 1 bulgusu:** fingerprint-chromium 148 canlı `Runtime.consoleAPICalled`
  ve `Runtime.exceptionThrown` bildirimi göndermiyor (headed/headless, Playwright
  dinleyicisi ve ham CDP oturumuyla doğrulandı); Playwright `console`/`pageerror`
  olayları sayfa script'leri için hiç tetiklenmiyor. Motor V8'in sayfa başına
  console deposunu (son 1000 kayıt) tutuyor ve `Runtime.enable` bunu yeniden
  oynatıyor. Bu yüzden `console_read` çekme (pull) modelinde: sekme başına ayrı
  bir CDP oturumunda Runtime kapatılıp açılır, replay toplanır, daha önce
  görülmeyenler ring buffer'a yazılır; WS akışı console aboneleri varken 2 sn'de
  bir çeker. Sayfa bunu gözlemleyemiyor (loglanan nesnenin getter'ı çalışmıyor),
  enjeksiyon yok. `Log.entryAdded` kaynaklı kayıtlar (kaynak yüklenemedi, CSP)
  canlı gelmeye devam ediyor.
  Her olay `{ profileId, tabId, type, ts, data }` şeklinde bir EventEmitter'a
  düşer; WS ve MCP notifications buradan beslenir. Son N olay (örn. 2000)
  profil başına ring buffer'da tutulur, böylece ajan "son 50 console hatasını
  getir" diyebilir.
- Ağ yakalama: `page.route()` ile istek engelleme/değiştirme (`network.block`,
  `network.mock`), `response.body()` ile gövde okuma (boyut sınırı 2 MB).
- CDP: `context.newCDPSession(page)` ile sekme başına oturum; `cdp.send(method,
  params)` doğrudan geçirilir. Sekme başına oturum cache'lenir, sekme kapanınca
  detach edilir. Browser seviyesi için `context.browser()?.newBrowserCDPSession()`.
- Ekran görüntüsü: `page.screenshot({ type, fullPage, clip })`, base64 döner.
  Element için `locator.screenshot()`.
- Erişilebilirlik ağacı / snapshot: `locator.ariaSnapshot()` ile YAML benzeri
  ağaç. Her interaktif elemente `ref` verilir (`e12`); sonraki `click`, `fill`
  çağrıları `ref` ile hedefler. (Chrome DevTools MCP ve Playwright MCP de bu
  modeli kullanır; ajanlar için en güvenilir hedefleme yolu.)
- Seçici hedefleme: `ref` dışında CSS, `text=`, `role=` ve XPath kabul edilir
  (`page.locator(selector)`).

### 3.2 `src/main/automation/server.ts` — HTTP + WS sunucu
- Node `http` + `ws` (yeni, küçük bağımlılık). Yalnızca `127.0.0.1`'e bind.
  Port varsayılan `48123`, ayarlardan değiştirilebilir, `0` ise rastgele.
- Kimlik doğrulama: `Authorization: Bearer <token>`. Token ilk açılışta üretilir
  (`crypto.randomBytes(32)`), `settings.automation.token` içinde saklanır,
  Settings sayfasında "Kopyala / Yenile" düğmesi olur. Token'sız istek 401.
- Discovery dosyası: `%APPDATA%/FacetBrowser/automation.json` →
  `{ "port": 48123, "token": "…", "pid": 1234 }`. `facetbrowser-mcp` paketi
  bunu okur; kullanıcı hiçbir şey kopyalamak zorunda kalmaz.
- CORS yok (tarayıcı istemcisi beklenmiyor); `Origin` başlığı taşıyan istek
  reddedilir (DNS rebinding önlemi).
- WS: `ws://127.0.0.1:<port>/events?token=…&profile=…` olay akışı; isteğe
  bağlı `types` filtresi.

### 3.3 `src/main/automation/mcp.ts` — MCP sunucusu (Streamable HTTP)
- `@modelcontextprotocol/sdk` (`McpServer` + `StreamableHTTPServerTransport`),
  `POST/GET/DELETE /mcp`. Aynı Bearer token.
- Araçlar (tools) aşağıda §4. Kaynaklar (resources):
  `facet://profiles`, `facet://profile/{id}/tabs`,
  `facet://profile/{id}/console?last=100`. Console ve pageerror olayları
  `notifications/message` olarak akar (istemci destekliyorsa).
- Oturum başına "aktif profil / aktif sekme" bağlamı tutulur, böylece ajan her
  çağrıda id vermek zorunda kalmaz (`select_profile`, `select_tab`).

### 3.4 `packages/facetbrowser-mcp` — ince stdio köprüsü (npm)
- `npx facetbrowser-mcp` ile çalışır; `automation.json`'u bulur, HTTP API'ye
  bağlanır, `tools/list` ve `tools/call`'u aynen iletir. Uygulama kapalıysa
  "FacetBrowser çalışmıyor, aç ve Settings > Automation'ı etkinleştir" der.
- Claude Desktop konfigürasyonu tek satır olur:
  `{ "mcpServers": { "facetbrowser": { "command": "npx", "args": ["-y", "facetbrowser-mcp"] } } }`

### 3.5 Opsiyonel: ham CDP port (ileri düzey ajanlar için)
- Settings'te "Expose CDP endpoint per profile" anahtarı. Açıkken launcher
  `--remote-debugging-port=0` da ekler; Chromium `DevToolsActivePort` dosyasına
  portu yazar, API `GET /profiles/{id}` yanıtında `cdpUrl` döner
  (`ws://127.0.0.1:<p>/devtools/browser/<guid>`).
- Böylece chrome-devtools-mcp, Puppeteer `connect({browserWSEndpoint})`,
  Playwright `connectOverCDP` doğrudan profile bağlanır.
- **Doğrulanacak**: fingerprint-chromium 148 build'inde `--remote-debugging-pipe`
  ile `--remote-debugging-port` aynı anda çalışıyor mu? Chromium kaynağında
  ikisi bağımsız dallardır, birlikte çalışması beklenir; Faz 0'da kısa bir
  deneme ile teyit edilir. Çalışmazsa alternatif: CDP'yi Playwright oturumları
  üzerinden WebSocket'e köprüleyen bir proxy (daha çok iş, `Target.*`
  mesajlarını kendimiz yönetiriz). Yalnızca gerekirse.
- DevTools'un kendi auth'u olmadığı için bu özellik varsayılan kapalı kalır ve
  port yalnızca localhost'a bağlanır.
- **Faz 0 sonucu (2026-11-09, fingerprint-chromium 148.0.7778.215, Windows x64):** `--remote-debugging-pipe` ile `--remote-debugging-port=0` birlikte çalışıyor; Playwright pipe üzerinden sayfayı sürerken `DevToolsActivePort` dosyası yazıldı ve `http://127.0.0.1:<port>/json/version` yanıt verdi (`ws://127.0.0.1:<port>/devtools/browser/<guid>`). Köprü proxy'ye gerek yok; `exposeCdp` ayarı doğrudan bu bayrağı ekler.

---

## 4. MCP araç listesi (tools)

İsimler `facet_` önekli; parametreler JSON Schema ile tanımlı, her aracın
description'ı ajana ne zaman kullanılacağını söyler.

**Profiller**
- `facet_list_profiles` → id, ad, grup, proxy ülkesi, çalışıyor mu, sekme sayısı
- `facet_launch_profile {profileId | name}` → çalışır hale gelince döner, ilk tabId
- `facet_stop_profile {profileId}`
- `facet_create_profile {name, os?, proxy?: savedId | "host:port:user:pass", tags?}` (mevcut `profiles:new` + fingerprint üretimi)
- `facet_profile_info {profileId}` → fingerprint özeti, proxy çıkış IP/ülke/tz, cdpUrl (açıksa)

**Sekmeler ve gezinme**
- `facet_list_tabs {profileId}` → tabId, url, title, active
- `facet_new_tab {profileId, url?}`, `facet_close_tab {tabId}`, `facet_select_tab {tabId}`
- `facet_navigate {tabId, url, waitUntil?: load|domcontentloaded|networkidle}`
- `facet_go_back / facet_go_forward / facet_reload {tabId}`
- `facet_wait_for {tabId, selector? | text? | url? | timeoutMs}`

**Sayfa okuma**
- `facet_snapshot {tabId, interactiveOnly?}` → aria snapshot + ref id'leri (ajanın ana gözü)
- `facet_get_text {tabId, selector?, maxChars?}` → innerText
- `facet_get_html {tabId, selector?, maxChars?}` → outerHTML
- `facet_screenshot {tabId, fullPage?, selector?, format?, quality?}` → image content block
- `facet_find {tabId, query}` → metin/role eşleşen elementler ve ref'leri

**Etkileşim**
- `facet_click {tabId, ref|selector, button?, clickCount?, modifiers?}`
- `facet_type {tabId, ref|selector, text, clear?, pressEnter?}` (insan hızında `delay` seçeneği)
- `facet_fill {tabId, ref|selector, value}` (input/textarea/select/checkbox)
- `facet_press {tabId, keys}` (`Control+A`, `Enter` …)
- `facet_hover`, `facet_scroll {tabId, direction|ref, amount?}`, `facet_drag {from, to}`
- `facet_upload_file {tabId, ref|selector, paths[]}` (yalnızca izin verilen klasörlerden, bkz. §6)
- `facet_handle_dialog {tabId, accept, promptText?}` (bekleyen alert/confirm/prompt)

**JavaScript**
- `facet_evaluate {tabId, expression | function, args?, awaitPromise?}` → JSON sonucu; hata ise stack
- `facet_evaluate_on_element {tabId, ref|selector, function}`
- `facet_add_init_script {profileId, source}` → **varsayılan kapalı**, Settings'te ayrıca açılmalı (anti-detect ilkesini bilerek bozar; uyarı metniyle)

**Console / hatalar**
- `facet_console_read {profileId|tabId, last?, level?, since?}` → ring buffer
- `facet_console_clear`, `facet_console_subscribe {tabId}` (notification akışı)

**Network**
- `facet_network_list {tabId, filter?: urlPattern|method|status|type, last?}` → id, method, url, status, type, size, timing
- `facet_network_get_body {requestId}` → gövde (metin ya da base64; sınır 2 MB)
- `facet_network_block {profileId, patterns[]}` / `facet_network_unblock`
- `facet_network_mock {profileId, pattern, status, headers?, body}` → `page.route` fulfill
- `facet_network_set_headers {profileId, headers}` → `context.setExtraHTTPHeaders`
- `facet_network_throttle {tabId, profile: offline|slow3g|fast3g|none}` (CDP `Network.emulateNetworkConditions`)

**Cookie / storage**
- `facet_cookies_get {profileId, urls?}` / `facet_cookies_set {profileId, cookies[]}` / `facet_cookies_clear`
- `facet_storage_get {tabId, kind: local|session, keys?}` / `facet_storage_set`
- `facet_session_export {profileId}` → mevcut `exportSession` (cookies + localStorage jar)

**Ham CDP**
- `facet_cdp_send {tabId|profileId, method, params?}` → sonuç JSON. Playwright `CDPSession` üzerinden; `Target.*` ve `Browser.close` gibi tehlikeli metodlar deny-list'te.
- `facet_cdp_subscribe {tabId, events[]}` → örn. `Network.webSocketFrameReceived`, `Performance.metrics`

**Proxy**
- `facet_proxy_check {profileId}` → mevcut checker ile çıkış IP, ülke, latency, grade
- `facet_proxy_list`, `facet_profile_set_proxy {profileId, savedId|config}` (profil kapalıyken)

Toplam yaklaşık 50 araç. İlk sürümde (Faz 2) çekirdek: profiles, tabs,
navigate, snapshot, click/type/fill/press, screenshot, evaluate, console_read,
network_list/get_body, cookies, cdp_send.

---

## 5. REST API (aynı servis, script'ler için)

Base: `http://127.0.0.1:<port>/v1`, `Authorization: Bearer <token>`.

| Method | Path | İş |
|---|---|---|
| GET | `/profiles` | liste |
| POST | `/profiles` | oluştur |
| POST | `/profiles/{id}/launch`, `/stop` | başlat / durdur |
| GET | `/profiles/{id}` | detay (+ `cdpUrl`) |
| GET/POST/DELETE | `/profiles/{id}/tabs`, `/tabs/{tabId}` | sekmeler |
| POST | `/tabs/{tabId}/navigate`, `/click`, `/type`, `/fill`, `/press`, `/evaluate`, `/screenshot`, `/snapshot` | eylemler (gövde MCP parametreleriyle aynı şema) |
| GET | `/tabs/{tabId}/console?last=`, `/network?last=` | kayıtlar |
| GET | `/network/{requestId}/body` | gövde |
| POST | `/profiles/{id}/cdp` | `{method, params}` |
| GET/PUT | `/profiles/{id}/cookies` | cookie |
| WS | `/events?profile=&types=` | olay akışı |
| GET | `/openapi.json` | şema (araç şemalarından üretilir) |

Araç tanımları (`name, description, inputSchema, handler`) tek bir kayıt
defterinde (`registry.ts`) tutulur; MCP `tools/list`, REST router ve
`openapi.json` aynı listeden üretilir. Yeni bir yetenek bir kez eklenir.

---

## 6. Güvenlik ve sınırlar

- **Sadece localhost.** 127.0.0.1'e bind, `Origin` başlıklı istek reddedilir,
  token zorunlu. Uzaktan erişim isteyen kullanıcı SSH tüneli kullanır (docs'ta
  anlatılır); uygulama kendisi LAN'a açılmaz.
- **Varsayılan kapalı.** Settings > Automation'da "Enable automation API"
  anahtarı. Açıkken üst barda küçük bir "API on" rozeti (kullanıcı ajanların
  tarayıcısını sürebildiğini bilsin).
- **Tehlikeli yetenekler ayrı anahtarlarla:** init script enjeksiyonu, ham CDP,
  dosya yükleme (`allowedUploadDirs` listesi), CDP port açma.
- **Profil kapsamı (opsiyonel, Faz 3):** token'a izin verilen profil/grup
  listesi bağlanabilir; örn. ajan sadece "Automation" grubundaki profilleri görür.
- **Oran ve boyut sınırları:** screenshot en fazla 1 / 200 ms / sekme, evaluate
  sonucu 1 MB, network body 2 MB, ring buffer 2000 olay.
- **Denetim günlüğü:** her araç çağrısı `logs/automation.log`'a (zaman, araç,
  profil, süre, hata). Settings'ten görüntülenebilir.
- **Anti-detect ile uyum:** varsayılan mod sayfaya hiçbir şey enjekte etmez;
  `evaluate` yalnızca çağrı anında çalışır. `navigator.webdriver` engine'den
  false kalır. `--remote-debugging-port` sayfadan tespit edilemez. Not: hiçbir
  otomasyon insan gibi değildir; `type` için `delay` ve `click` için küçük
  rastgele gecikme seçenekleri sunulur ama "tespit edilemez" vaadi verilmez.

---

## 7. Uygulama fazları

**Faz 0 — Keşif (0.5 gün) — tamamlandı (2026-11-09)**
- fingerprint-chromium'da pipe + port birlikte test et (§3.5).
- `ariaSnapshot()` çıktısına ref ekleyen küçük prototip; Playwright 1.64'te
  ref üreten hazır bir seçenek var mı kontrol et.
  **Sonuç:** var. `page.ariaSnapshot({ mode: 'ai' })` her elemente `[ref=eN]`
  ekler, `page.getByRef('eN')` son snapshot'a göre çözer. `snapshot.ts` yalnızca
  bu çıktıyı filtreler (`interactiveOnly`) ve `find` için satırları ayrıştırır.
- `@modelcontextprotocol/sdk` ve `ws` paketlerini ekle; electron-vite
  `externalizeDepsPlugin` ile main bundle dışında kalır, electron-builder
  ASAR'a dahil eder.

**Faz 1 — Servis katmanı + REST (2-3 gün) — tamamlandı (2026-11-09)**
- `src/main/automation/{service,registry,server,events}.ts`. `browser:*` IPC
  handler'larını servise taşı; `launcher.ts`'deki tab takibini `tabId` ile
  genişlet. Event ring buffer. REST + WS. Settings'e `automation: { enabled,
  port, token, exposeCdp, allowInitScript, allowedUploadDirs }` alanı +
  Settings sayfası bölümü (i18n TR/EN). `automation.json` discovery dosyası.
- Test: `curl` ile profil aç, navigate, evaluate, screenshot.
- Not: `allowInitScript` ve `allowedUploadDirs` ayarları Faz 3'e bırakıldı
  (araçları da orada); Faz 1 ayarı `{ enabled, port, token, exposeCdp }`.
  `@modelcontextprotocol/sdk` Faz 2'de eklenecek. `facet_handle_dialog` ve
  `facet_tab_info` çekirdeğe erken alındı; `GET /v1/tools` araç tanımlarını
  MCP biçiminde verir.

**Faz 2 — MCP sunucusu (2-3 gün)**
- `mcp.ts` Streamable HTTP; çekirdek 20 araç; resources; console notification.
- Claude Code ile uçtan uca dene:
  `claude mcp add --transport http facetbrowser http://127.0.0.1:48123/mcp --header "Authorization: Bearer …"`.
- `packages/facetbrowser-mcp` stdio köprüsü, npm'e yayın.

**Faz 3 — Tam yüzey (2-3 gün)**
- Kalan araçlar: network mock/block/throttle, storage, dialog, upload, drag,
  cdp_subscribe, proxy araçları, profil oluşturma.
- Opsiyonel CDP port; profil kapsamlı token; denetim günlüğü ekranı.
- README'ye "Automation & MCP" bölümü, Claude Code / Cursor / Claude Desktop
  örnek konfigürasyonları, `openapi.json` linki.

**Faz 4 — Sertleştirme (1-2 gün)**
- Profil kapanırken açık CDP oturumlarının temizlenmesi; stop sırasında asılı
  `evaluate` çağrılarının iptali (AbortSignal, `CLOSE_MS` ile uyumlu).
- Yük testi: 10 profil × 5 sekme, 1000 network olayı/sn; bellek sınırı.
- Hata mesajlarının ajan-dostu olması ("Tab t_ab12 not found; call facet_list_tabs").

---

## 8. Açık kararlar

1. **Plan kapısı:** Automation API tüm planlarda mı, yalnızca `unlimited` mı? (Cloud gate ile kolay; ürün kararı.)
2. **Port vs. pipe-köprü:** Faz 0 testi sonucuna göre.
3. **npm paket adı:** `facetbrowser-mcp` müsait mi; değilse `@facetbrowser/mcp`.
4. **Facet Lite (web) ile ilişki:** API yalnızca masaüstünde çalışan profilleri sürer. İleride cloud üzerinden uzak makinedeki FacetBrowser'a köprü isteniyorsa ayrı bir relay tasarımı gerekir; bu planın dışında.
5. **Init script enjeksiyonu** gerçekten gerekli mi, yoksa kullanıcı anahtarıyla açılan CDP `Page.addScriptToEvaluateOnNewDocument` yeterli mi? Öneri: tek anahtar, CDP yolu; ayrı araç yazma.

---

## 9. Dosya haritası (planlanan)

```
src/main/automation/
  service.ts      AutomationService: profiles/tabs/actions/events, Playwright + CDP
  registry.ts     Tool tanımları (name, description, schema, handler): MCP + REST + OpenAPI tek kaynak
  server.ts       http + ws: Bearer auth, REST router, /events, /openapi.json, discovery dosyası
  mcp.ts          McpServer + StreamableHTTPServerTransport, resources, notifications
  snapshot.ts     ariaSnapshot → ref haritası
  events.ts       Ring buffer + EventEmitter
src/shared/automation.ts                  Paylaşılan tipler (ToolCall, Event, AutomationSettings)
src/renderer/src/pages/SettingsPage.tsx   "Automation" bölümü (enable, port, token, anahtarlar, log)
packages/facetbrowser-mcp/                stdio köprüsü (ayrı package.json, tsup ile build)
docs/automation.md                        kullanıcı dokümanı (Claude Code / Cursor / Desktop örnekleri)
```
