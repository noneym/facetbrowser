#!/usr/bin/env node
// facetbrowser-mcp: stdio <-> Streamable HTTP bridge for clients that only
// speak stdio (Claude Desktop). Finds the running FacetBrowser through its
// discovery file, connects to http://127.0.0.1:<port>/mcp with the token and
// forwards tools, resources and log notifications unchanged.
//
// Overrides: FACETBROWSER_MCP_URL (full /mcp URL) and FACETBROWSER_TOKEN,
// for an SSH tunnel or a non-default data directory.
//
// Remote: `facetbrowser-mcp --remote [deviceId]` goes through the
// facetbrowser.com relay instead (FACETBROWSER_RELAY_TOKEN from your account
// page; FACETBROWSER_RELAY_URL to point at another server). Without a device
// id it lists the account's devices and, on a terminal, lets you pick one.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SetLevelRequestSchema,
  LoggingMessageNotificationSchema
} from '@modelcontextprotocol/sdk/types.js'

const log = (msg) => process.stderr.write(`[facetbrowser-mcp] ${msg}\n`)
const DEFAULT_RELAY = 'https://facetbrowser.com'

function parseArgs(argv) {
  const out = { remote: false, deviceId: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--remote') {
      out.remote = true
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) out.deviceId = argv[++i]
    } else if (a === '-h' || a === '--help') out.help = true
    else log(`unknown argument ${a}`)
  }
  return out
}

function discoveryFile() {
  if (process.env.FACETBROWSER_DATA_DIR) return path.join(process.env.FACETBROWSER_DATA_DIR, 'automation.json')
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'FacetBrowser', 'automation.json')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'FacetBrowser', 'automation.json')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'FacetBrowser', 'automation.json')
}

function readDiscovery() {
  const file = discoveryFile()
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (d.port && d.token) return { url: `http://127.0.0.1:${d.port}/mcp`, token: d.token, file }
  } catch {
    /* no file */
  }
  return null
}

// ---- remote (facetbrowser.com relay) -------------------------------------

async function relayDevices(base, token) {
  const res = await fetch(`${base}/api/relay/devices`, { headers: { authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new Error('The relay token was refused. Make one on your account page (facetbrowser.com/account › Remote access) and set FACETBROWSER_RELAY_TOKEN.')
  if (!res.ok) throw new Error(`Relay answered HTTP ${res.status} for /api/relay/devices`)
  return res.json()
}

function describe(d) {
  return `${d.name} [${d.id}] ${d.online ? `online, ${d.running} running${d.version ? `, v${d.version}` : ''}` : 'offline'}`
}

async function pick(devices) {
  const online = devices.filter((d) => d.online)
  if (devices.length === 0) throw new Error('No devices on this account. Sign in to FacetBrowser on the computer you want to drive, then enable Settings › Automation API › Allow remote access.')
  if (online.length === 1 && !process.stdin.isTTY) return online[0]
  if (!process.stdin.isTTY) {
    throw new Error(`Several devices; pass one with --remote <deviceId>:\n${devices.map((d) => '  ' + describe(d)).join('\n')}`)
  }
  process.stderr.write('Devices on this account:\n')
  devices.forEach((d, i) => process.stderr.write(`  ${i + 1}. ${describe(d)}\n`))
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  const answer = await new Promise((resolve) => rl.question('Which one? ', resolve))
  rl.close()
  const idx = parseInt(answer, 10) - 1
  const chosen = devices[idx] || devices.find((d) => d.id === answer.trim())
  if (!chosen) throw new Error('No such device')
  return chosen
}

async function resolveRemote(args) {
  const token = process.env.FACETBROWSER_RELAY_TOKEN
  if (!token) throw new Error('Set FACETBROWSER_RELAY_TOKEN to a relay token from your account page (facetbrowser.com/account › Remote access).')
  const base = (process.env.FACETBROWSER_RELAY_URL || DEFAULT_RELAY).replace(/\/$/, '')
  let deviceId = args.deviceId
  if (!deviceId) {
    const devices = await relayDevices(base, token)
    const chosen = await pick(devices)
    deviceId = chosen.id
    if (process.stdin.isTTY) {
      // Interactive run: print the config to paste and exit; MCP clients start us without a TTY.
      process.stderr.write(`\nUsing ${describe(chosen)}\n\nClaude Desktop (claude_desktop_config.json):\n`)
      process.stderr.write(JSON.stringify({ mcpServers: { facetbrowser: { command: 'npx', args: ['-y', 'facetbrowser-mcp', '--remote', deviceId], env: { FACETBROWSER_RELAY_TOKEN: '<relay token>', ...(base !== DEFAULT_RELAY ? { FACETBROWSER_RELAY_URL: base } : {}) } } } }, null, 2) + '\n')
      process.stderr.write(`\nClaude Code / Cursor:\n  claude mcp add --transport http facet-home ${base}/api/relay/${deviceId}/mcp --header "Authorization: Bearer <relay token>"\n`)
    }
  }
  return { url: `${base}/api/relay/${deviceId}/mcp`, token }
}

async function connect(args) {
  let url = process.env.FACETBROWSER_MCP_URL
  let token = process.env.FACETBROWSER_TOKEN
  if (args.remote) {
    const r = await resolveRemote(args)
    url = r.url
    token = r.token
  } else if (!url || !token) {
    const d = readDiscovery()
    if (!d) {
      throw new Error(`FacetBrowser is not running or its Automation API is off. Open FacetBrowser, enable Settings > Automation API, and try again (looked for ${discoveryFile()}). For a FacetBrowser on another machine use --remote.`)
    }
    url = url || d.url
    token = token || d.token
  }
  const client = new Client({ name: 'facetbrowser-mcp', version: '0.2.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  await client.connect(transport)
  return { client, url }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stderr.write('facetbrowser-mcp [--remote [deviceId]]\n  env: FACETBROWSER_MCP_URL, FACETBROWSER_TOKEN, FACETBROWSER_DATA_DIR, FACETBROWSER_RELAY_TOKEN, FACETBROWSER_RELAY_URL\n')
    return
  }
  const { client, url } = await connect(args)
  log(`connected to ${url}`)
  const info = client.getServerVersion()
  const server = new Server({ name: 'facetbrowser', version: info?.version || '0.0.0' }, { capabilities: { tools: {}, resources: {}, logging: {} }, instructions: client.getInstructions() })

  server.setRequestHandler(ListToolsRequestSchema, async (req) => client.listTools(req.params))
  server.setRequestHandler(CallToolRequestSchema, async (req) => client.callTool(req.params))
  server.setRequestHandler(ListResourcesRequestSchema, async (req) => client.listResources(req.params))
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (req) => client.listResourceTemplates(req.params))
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => client.readResource(req.params))
  server.setRequestHandler(SetLevelRequestSchema, async (req) => client.setLoggingLevel(req.params.level))
  client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => server.sendLoggingMessage(n.params).catch(() => {}))
  client.onclose = () => {
    log('FacetBrowser closed the connection')
    server.close().finally(() => process.exit(0))
  }

  const stdio = new StdioServerTransport()
  await server.connect(stdio)
}

main().catch((e) => {
  log(e.message || String(e))
  process.exit(1)
})
