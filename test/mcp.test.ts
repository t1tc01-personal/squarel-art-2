import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { silentLogger } from '../src/log.ts'
import { createMcpServer } from '../src/mcp/server.ts'
import { MockProvider } from '../src/providers/mock.ts'
import { createToolContext } from '../src/tools/context.ts'
import { ALL_TOOLS } from '../src/tools/registry.ts'
import { tempDir } from './helpers.ts'

let t: ReturnType<typeof tempDir>
beforeEach(() => {
  t = tempDir()
})
afterEach(() => t.cleanup())

type Content = { type: string; text?: string; data?: string; mimeType?: string }

describe('MCP server (in-memory transport)', () => {
  it('lists every tool with a JSON schema and returns text + image content', async () => {
    const ctx = await createToolContext({
      config: { dataDir: t.dir, imageProvider: 'mock' },
      providers: { mock: new MockProvider() },
      log: silentLogger,
    })
    const server = createMcpServer(ctx)
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(b)

    const { tools } = await client.listTools()
    expect(tools.map((x) => x.name).sort()).toEqual(ALL_TOOLS.map((x) => x.name).sort())
    const draw = tools.find((x) => x.name === 'draw_pixels')!
    expect(draw.inputSchema.type).toBe('object')
    expect(Object.keys(draw.inputSchema.properties ?? {})).toContain('ops')
    expect(tools.find((x) => x.name === 'canvas_view')!.annotations?.readOnlyHint).toBe(true)

    const created = await client.callTool({
      name: 'project_create',
      arguments: { name: 'MCP test', width: 8, height: 8 },
    })
    const content = created.content as Content[]
    expect(content[0].type).toBe('text')
    expect(content[0].text).toContain('mcp-test')
    expect(content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' })

    const gen = await client.callTool({
      name: 'generate_image',
      arguments: { prompt: 'mushroom', variants: 2 },
    })
    expect((gen.content as Content[])[0].text).toMatch(/Proposal p_/)

    const bad = await client.callTool({ name: 'project_open', arguments: { project: 'does-not-exist' } })
    expect(bad.isError).toBe(true)
    expect((bad.content as Content[])[0].text).toMatch(/^\[NOT_FOUND\]/)

    const invalid = await client.callTool({ name: 'draw_pixels', arguments: { ops: 'nope' } })
    expect(invalid.isError).toBe(true)
    await client.close()
  })
})

describe('MCP server over stdio (as Claude Code runs it)', () => {
  it('starts with node, keeps stdout clean and answers tool calls', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(import.meta.dirname, '..', 'src', 'mcp', 'index.ts')],
      env: {
        ...(process.env as Record<string, string>),
        DATA_DIR: t.dir,
        IMAGE_PROVIDER: 'mock',
        SQUAREL_NO_BRIDGE: '1',
      },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'stdio-test', version: '1.0.0' })
    await client.connect(transport)
    const info = client.getServerVersion()
    expect(info?.name).toBe('squarel')
    expect(client.getInstructions()).toContain('PROPOSALS')
    const list = await client.callTool({ name: 'project_list', arguments: {} })
    expect((list.content as Content[])[0].text).toContain('No projects yet')
    const created = await client.callTool({
      name: 'project_create',
      arguments: { name: 'stdio', width: 4, height: 4 },
    })
    expect(created.isError).toBeFalsy()
    const opened = await client.callTool({ name: 'open_in_editor', arguments: {} })
    expect((opened.content as Content[])[0].text).toMatch(/bridge/i)
    await client.close()
  }, 60000)
})
