# FacetBrowser Automation API

A local HTTP + WebSocket API through which AI agents (Claude Code, Cursor, Claude
Desktop via the upcoming MCP server) and your own scripts drive FacetBrowser
profiles: launch and stop, tabs, navigation, accessibility snapshots with element
refs, click/type/fill, JavaScript, console and network history, screenshots,
cookies and raw Chrome DevTools Protocol. Design and roadmap:
[`mcp-automation-plan.md`](mcp-automation-plan.md).

Status: Faz 1 (service layer, REST, WebSocket) and Faz 2 (MCP server + stdio bridge) are done. Remote access through facetbrowser.com is planned (plan §10).

## Enable

Settings › **Automation API** › *Enable the Automation API*, then Save. The
server listens on `127.0.0.1:48123` (port configurable; `0` = random). The token
is generated once and shown there (Copy / Regenerate).

While the server runs it writes a discovery file so local clients never need a
copy-paste:

```
%APPDATA%\FacetBrowser\automation.json      (Windows)
~/Library/Application Support/FacetBrowser/automation.json   (macOS)
```

```json
{ "port": 48123, "token": "…", "pid": 1234, "version": "0.3.22" }
```

The file is removed when the server stops or the app quits normally. After a
crash or a forced kill a stale file can remain: treat it as valid only when
`pid` is alive and `GET /health` answers.

## Connect an AI agent (MCP)

The same server speaks MCP (Streamable HTTP) at `http://127.0.0.1:48123/mcp`
with the same Bearer token. 38 tools (`facet_*`), resources (`facet://profiles`,
`facet://profile/{id}/tabs|console|network`) and console/page errors as MCP log
notifications.

**Claude Code**

```bash
claude mcp add --transport http facetbrowser http://127.0.0.1:48123/mcp --header "Authorization: Bearer <token>"
```

**Cursor** (`.cursor/mcp.json`):

```json
{ "mcpServers": { "facetbrowser": { "url": "http://127.0.0.1:48123/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```

**Claude Desktop** only speaks stdio, so it goes through the
[`facetbrowser-mcp`](../packages/facetbrowser-mcp) bridge, which reads port and
token from `automation.json` by itself:

```json
{ "mcpServers": { "facetbrowser": { "command": "npx", "args": ["-y", "facetbrowser-mcp"] } } }
```

Until the package is published on npm, point `command` at `node` and `args` at
the checked-out `packages/facetbrowser-mcp/index.js`.

Session context: `facet_select_profile` / `facet_select_tab` make a profile and
tab the default, after which `tabId` / `profileId` can be omitted;
`facet_launch_profile` and `facet_new_tab` select what they created.
`facet_session_info` shows the selection. Each MCP session (one per client
connection) has its own context.

**Remote machine?** Not yet. The API is local by design; for now use an SSH
tunnel (`ssh -L 48123:127.0.0.1:48123 home-pc`) and set
`FACETBROWSER_MCP_URL` / `FACETBROWSER_TOKEN` for the bridge. A relay through
facetbrowser.com (outbound connection from the app, scoped relay tokens) is
planned in the plan document, §10.

## Rules

- **Localhost only.** Bound to 127.0.0.1. Requests that carry an `Origin` header
  (a web page) or a non-loopback `Host` are refused with 403, so a site cannot
  reach the API even if it learns the port.
- **Bearer token.** Every request needs `Authorization: Bearer <token>`; the
  WebSocket also accepts `?token=`. Only `GET /health` is open.
- **Nothing is injected into pages.** `facet_evaluate` runs when called, through
  Playwright's own `Runtime.evaluate`. No init scripts, no console hooks. The
  engine keeps reporting `navigator.webdriver === false` (check it yourself with
  the CDP example below).
- **Off by default.** Keep it off when no agent needs it: while it is on, any
  local process holding the token can drive your profiles.
- Every call is appended to `%APPDATA%\FacetBrowser\logs\automation.log`
  (time, tool, ids, duration, error; never payloads).

## Walkthrough with curl

All examples assume:

```bash
export FACET=http://127.0.0.1:48123
export AUTH="Authorization: Bearer $(node -p "require(process.env.APPDATA+'/FacetBrowser/automation.json').token")"
```

(PowerShell: `$t = (Get-Content $env:APPDATA\FacetBrowser\automation.json | ConvertFrom-Json).token`
and pass `-H "Authorization: Bearer $t"`.)

List profiles:

```bash
curl -H "$AUTH" $FACET/v1/profiles
```

```json
{"profiles":[{"id":"p_autotest01","name":"Automation Test","tags":["automation"],"proxy":{"mode":"none"},"state":"idle","tabs":0}]}
```

Launch one (by id or exact name). Returns when it is running, with its tabs:

```bash
curl -X POST -H "$AUTH" $FACET/v1/profiles/p_autotest01/launch
```

```json
{"profile":{"id":"p_autotest01","state":"running","tabs":1,"cdpUrl":"ws://127.0.0.1:62825/devtools/browser/…"},
 "tabs":[{"tabId":"t_2w98bb","profileId":"p_autotest01","url":"about:blank","title":"","active":true}]}
```

Navigate the tab:

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","waitUntil":"load"}' $FACET/v1/tabs/t_2w98bb/navigate
```

```json
{"url":"https://example.com/","title":"Example Domain","status":200}
```

Run JavaScript and get the result as JSON:

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"expression":"document.title"}' $FACET/v1/tabs/t_2w98bb/evaluate
```

```json
{"value":"Example Domain"}
```

Screenshot (base64; `fullPage`, `clip`, `ref`/`selector`, `format`, `quality`):

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"format":"jpeg","quality":60}' $FACET/v1/tabs/t_2w98bb/screenshot \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>require("fs").writeFileSync("shot.jpg",Buffer.from(JSON.parse(d).base64,"base64")))'
```

Console history (console.* calls, uncaught errors, dialogs; last 2000 per profile):

```bash
curl -H "$AUTH" "$FACET/v1/tabs/t_2w98bb/console?last=20"
curl -H "$AUTH" "$FACET/v1/tabs/t_2w98bb/console?level=error"
curl -X DELETE -H "$AUTH" $FACET/v1/tabs/t_2w98bb/console
```

```json
{"events":[{"seq":61,"ts":1794233760167,"profileId":"p_autotest01","tabId":"t_2w98bb","type":"console",
  "data":{"level":"warning","text":"w1","url":"","line":1,"column":8,"source":"console"}},
 {"seq":62,"ts":…,"type":"pageerror","data":{"message":"Error: err1","stack":"Error: err1\n    at …"}}]}
```

Read the page the way an agent should, with element refs, then act on a ref:

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"interactiveOnly":true}' $FACET/v1/tabs/t_2w98bb/snapshot
# {"snapshot":"- link \"Learn more\" [ref=e13] [cursor=pointer]","refs":1,…}

curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"ref":"e13"}' $FACET/v1/tabs/t_2w98bb/click
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"loadState":"domcontentloaded"}' $FACET/v1/tabs/t_2w98bb/wait
curl -H "$AUTH" $FACET/v1/tabs/t_2w98bb
```

Forms: `type` presses keys one by one (`delayMs` for human speed), `fill` sets a
value at once and also handles `<select>` and checkboxes, `press` sends keys:

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" -d '{"selector":"#q","text":"hello","delayMs":30}' $FACET/v1/tabs/t_2w98bb/type
curl -X POST -H "$AUTH" -H "Content-Type: application/json" -d '{"selector":"#country","value":"TR"}'            $FACET/v1/tabs/t_2w98bb/fill
curl -X POST -H "$AUTH" -H "Content-Type: application/json" -d '{"selector":"#agree","value":true}'              $FACET/v1/tabs/t_2w98bb/fill
curl -X POST -H "$AUTH" -H "Content-Type: application/json" -d '{"keys":"Enter"}'                                $FACET/v1/tabs/t_2w98bb/press
```

Network history and a response body (text, or base64 for binary; 2 MB cap):

```bash
curl -H "$AUTH" "$FACET/v1/tabs/t_2w98bb/network?type=xhr&last=20"
curl -H "$AUTH" "$FACET/v1/tabs/t_2w98bb/network?url=/api\\/v2\\/.*json/i"
curl -H "$AUTH" $FACET/v1/network/r_1f/body
```

Cookies (works for a stopped profile too; it is opened headless for a moment):

```bash
curl -H "$AUTH" "$FACET/v1/profiles/p_autotest01/cookies?urls=https://example.com"
curl -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"cookies":[{"name":"a","value":"1","domain":".example.com"}]}' $FACET/v1/profiles/p_autotest01/cookies
curl -X DELETE -H "$AUTH" $FACET/v1/profiles/p_autotest01/cookies
```

Raw CDP through the tab's session (`Target.*` and `Browser.close` are refused):

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"method":"Runtime.evaluate","params":{"expression":"navigator.webdriver","returnByValue":true}}' \
  $FACET/v1/tabs/t_2w98bb/cdp
# {"result":{"result":{"type":"boolean","value":false}}}
```

Tabs and shutdown:

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" -d '{"url":"https://example.org"}' $FACET/v1/profiles/p_autotest01/tabs
curl -X DELETE -H "$AUTH" $FACET/v1/tabs/t_j42rou
curl -X POST -H "$AUTH" $FACET/v1/profiles/p_autotest01/stop
```

## Event stream

```
ws://127.0.0.1:48123/v1/events?profile=<id>&types=console,pageerror,framenavigated
```

Authenticate with the `Authorization` header or `?token=`. Each message is one
event: `{ seq, ts, profileId, tabId, type, data }`. Types: `console`, `pageerror`,
`dialog`, `request`, `response`, `requestfailed`, `framenavigated`, `page`
(new tab), `close` (tab closed; with `tabId: null` the profile closed). The first
message is `{ "type": "hello" }`.

```js
const ws = new WebSocket('ws://127.0.0.1:48123/v1/events?profile=p_…&types=console,pageerror', { headers: { Authorization: 'Bearer ' + token } })
ws.on('message', (m) => console.log(JSON.parse(m)))
```

## Reference

- `POST/GET/DELETE /mcp` — MCP Streamable HTTP endpoint (same token).
- `GET /openapi.json` — OpenAPI 3.1 for every route (generated from the tool
  registry, so it is always current).
- `GET /v1/tools` — the same capabilities as MCP-style tool definitions
  (`name`, `description`, `inputSchema`, `rest`). Tool names are `facet_*`; the
  REST body uses the same fields as the tool input, with `{tabId}` /
  `{profileId}` taken from the path. GET routes take them as query parameters.
- Errors are `{"error":{"code":"…","message":"…"}}` with 400 (bad input), 401,
  403, 404 (profile/tab/request not found), 408 (timeout), 409 (profile not
  running), 413, 500. Messages name the next call to make
  (`Tab t_x not found; call facet_list_tabs`).

| Area | Tools |
|---|---|
| Profiles | `facet_list_profiles`, `facet_profile_info`, `facet_launch_profile`, `facet_stop_profile` |
| Tabs | `facet_list_tabs`, `facet_new_tab`, `facet_tab_info`, `facet_close_tab`, `facet_select_tab` |
| Navigation | `facet_navigate`, `facet_go_back`, `facet_go_forward`, `facet_reload`, `facet_wait_for` |
| Reading | `facet_snapshot`, `facet_find`, `facet_get_text`, `facet_get_html`, `facet_screenshot` |
| Interaction | `facet_click`, `facet_type`, `facet_fill`, `facet_press`, `facet_hover`, `facet_scroll`, `facet_handle_dialog` |
| JavaScript | `facet_evaluate` (expression or function + args; `ref`/`selector` exposes `el`) |
| Console | `facet_console_read`, `facet_console_clear` |
| Network | `facet_network_list`, `facet_network_get_body` |
| Cookies | `facet_cookies_get`, `facet_cookies_set`, `facet_cookies_clear` |
| CDP | `facet_cdp_send` (tab session, or browser session with `profileId` only) |

## Limits and engine notes

- Ring buffers: 2000 events per profile per group (console / network /
  lifecycle); network bodies 2 MB; `evaluate` results 1 MB; screenshots at most
  one per 200 ms per tab (a burst waits); snapshots truncated at 60 000 chars by
  default (`maxChars`, or `interactiveOnly` for a compact view).
- **Console is pulled, not streamed.** The FacetBrowser engine does not emit
  live `Runtime.consoleAPICalled` / `exceptionThrown` notifications, so
  `facet_console_read` replays the engine's own per-page console storage (last
  1000 entries) on each call and records only what is new. The WebSocket stream
  polls it every 2 s while a client subscribes to `console` or `pageerror`.
  Resource-load failures and CSP violations still arrive live.
- A response body is only available while the page that received it is still
  the current document; after navigating away Chromium drops it
  (`body_unavailable`). Read bodies before the next navigation.
- Refs (`e12`, `f1e3` inside iframes) are valid for the latest snapshot of that
  tab; take a new snapshot after the page changes.
- With a `dialog` listener attached, alerts/confirms/prompts stay open until the
  user clicks them or `facet_handle_dialog` answers; they are no longer
  auto-dismissed.
- **Expose a raw CDP port per profile** (Settings): the launcher adds
  `--remote-debugging-port=0` and `facet_profile_info` returns `cdpUrl`
  (`ws://127.0.0.1:<port>/devtools/browser/<guid>`) for chrome-devtools-mcp,
  Puppeteer `connect({ browserWSEndpoint })` or Playwright `connectOverCDP`.
  DevTools has no auth of its own, so this stays off unless you need it.
