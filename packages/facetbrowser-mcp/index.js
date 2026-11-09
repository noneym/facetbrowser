#!/usr/bin/env node
// facetbrowser-mcp: stdio <-> Streamable HTTP bridge for clients that only
// speak stdio (Claude Desktop). Finds the running FacetBrowser through its
// discovery file, connects to http://127.0.0.1:<port>/mcp with the token and
// forwards tools, resources and log notifications unchanged.
//
// Overrides: FACETBROWSER_MCP_URL (full /mcp URL) and FACETBROWSER_TOKEN,
// for an SSH tunnel or a non-default data directory.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

async function connect() {
  let url = process.env.FACETBROWSER_MCP_URL
  let token = process.env.FACETBROWSER_TOKEN
  if (!url || !token) {
    const d = readDiscovery()
    if (!d) {
      throw new Error(`FacetBrowser is not running or its Automation API is off. Open FacetBrowser, enable Settings > Automation API, and try again (looked for ${discoveryFile()}).`)
    }
    url = url || d.url
    token = token || d.token
  }
  const client = new Client({ name: 'facetbrowser-mcp', version: '0.1.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  await client.connect(transport)
  return { client, url }
}

async function main() {
  const { client, url } = await connect()
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
