# facetbrowser-mcp

stdio bridge to the MCP server inside a running [FacetBrowser](https://facetbrowser.com)
on the same machine. For clients that only support stdio MCP servers (Claude
Desktop). Clients that support Streamable HTTP (Claude Code, Cursor) can connect
directly to `http://127.0.0.1:48123/mcp` instead; see `docs/automation.md`.

1. In FacetBrowser: Settings › Automation API › enable, Save.
2. Claude Desktop `claude_desktop_config.json`:

```json
{ "mcpServers": { "facetbrowser": { "command": "npx", "args": ["-y", "facetbrowser-mcp"] } } }
```

The bridge reads `automation.json` from FacetBrowser's data folder for port and
token, so nothing is copied by hand. Environment overrides:
`FACETBROWSER_MCP_URL` (full `/mcp` URL, e.g. through an SSH tunnel),
`FACETBROWSER_TOKEN`, `FACETBROWSER_DATA_DIR`.

## Remote machine

If FacetBrowser runs on another computer, turn on Settings › Automation API ›
*Allow remote access* there and create a relay token on
facetbrowser.com/account › Remote access. Then:

```json
{ "mcpServers": { "facetbrowser": { "command": "npx", "args": ["-y", "facetbrowser-mcp", "--remote", "<deviceId>"], "env": { "FACETBROWSER_RELAY_TOKEN": "fbr_…" } } } }
```

`npx facetbrowser-mcp --remote` without a device id lists the account's
devices and prints the config for the one you pick. `FACETBROWSER_RELAY_URL`
points at a server other than facetbrowser.com.
