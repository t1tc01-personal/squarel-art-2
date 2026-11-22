import type { IntegrationManifestT } from '@squarel/integration-schema'
import { describe, expect, it } from 'vitest'
import type { BridgeState } from '../src/main/bridge/types'
import { createDeps } from '../src/main/deps'
import { parseEnv } from '../src/main/env-store'
import { buildPresence } from '../src/main/presence'
import type { Registry } from '../src/main/registry/registry'

const NOW = new Date('2026-06-10T12:00:00.000Z')
const DATA = 'D:/data'
const iso = (secAgo: number) => new Date(NOW.getTime() - secAgo * 1000).toISOString()

function runFile(pid: number, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pid,
    cwd: 'D:\\work\\my-game',
    version: '0.1.0',
    startedAt: iso(600),
    updatedAt: iso(2),
    bridge: 'own',
    ...over,
  })
}

const bridge = (over: Partial<BridgeState> = {}): BridgeState => ({
  mode: 'own',
  port: 4321,
  clients: [],
  since: iso(100),
  ...over,
})

const reg = (client?: string): Registry => ({
  core: [],
  integrations: [
    {
      manifest: {
        schema: 1,
        id: 'aseprite',
        name: 'Aseprite',
        description: 'd',
        icon: 'icon.png',
        accent: '#112233',
        platforms: ['win32'],
        detect: {},
        install: [],
        launch: [],
        checks: [],
        ...(client ? { bridge: { client } } : {}),
      } as unknown as IntegrationManifestT,
      dir: 'D:/sq/integrations/aseprite',
      source: 'squarel',
    },
  ],
  comingSoon: [],
  problems: [],
})

function run(
  files: Record<string, string>,
  opts: { alive?: number[]; env?: string; b?: BridgeState; r?: Registry } = {},
) {
  const d = createDeps('fake', { files, now: NOW, alivePids: opts.alive ?? [] })
  return buildPresence(
    { dataDir: DATA, bridge: opts.b ?? bridge(), reg: opts.r ?? reg(), env: parseEnv(opts.env ?? '') },
    d,
  )
}

describe('connections presence', () => {
  it('drops files whose pid is dead even if fresh', async () => {
    const g = await run({ [`${DATA}/run/mcp-1.json`]: runFile(1) }, { alive: [] })
    expect(g[0]?.items).toEqual([])
  })

  it('drops files older than 30s even if the pid is alive (pid reuse)', async () => {
    const g = await run({ [`${DATA}/run/mcp-1.json`]: runFile(1, { updatedAt: iso(31) }) }, { alive: [1] })
    expect(g[0]?.items).toEqual([])
  })

  it('busy within 15s of lastToolAt', async () => {
    const files = {
      [`${DATA}/run/mcp-1.json`]: runFile(1, { lastTool: 'draw_pixels', lastToolAt: iso(5) }),
      [`${DATA}/run/mcp-2.json`]: runFile(2, { lastTool: 'draw_pixels', lastToolAt: iso(20) }),
    }
    const items = (await run(files, { alive: [1, 2] }))[0]?.items ?? []
    expect(items.map((i) => [i.title, i.status, i.subtitle])).toEqual([
      ['Phiên · my-game', 'busy', 'Đang gọi draw_pixels'],
      ['Phiên · my-game', 'online', 'Rảnh'],
    ])
  })

  it('maps bridge clients to integrations by bridge.client; unknown clients are not shown', async () => {
    const clients = [
      { name: 'aseprite', slug: 'hero', app: '1.3.18', connectedAt: iso(9), lastSeen: iso(1) },
      { name: 'mystery', slug: 'x', app: '9', connectedAt: iso(9), lastSeen: iso(1) },
    ]
    const g = await run({}, { b: bridge({ clients }), r: reg('aseprite') })
    expect(g[1]?.items.map((i) => [i.title, i.subtitle, i.status])).toEqual([
      ['Aseprite', 'hero · 1.3.18', 'online'],
    ])
  })

  it("neurons left sums today's cloudflare usage only", async () => {
    const line = (o: Record<string, unknown>) => JSON.stringify(o)
    const usage = [
      line({ ts: '2026-06-10T01:00:00Z', provider: 'cloudflare', unitKind: 'neuron', units: 1200 }),
      line({ ts: '2026-06-10T09:00:00Z', provider: 'cloudflare', unitKind: 'neuron', units: 300 }),
      line({ ts: '2026-06-09T23:59:59Z', provider: 'cloudflare', unitKind: 'neuron', units: 5000 }),
      line({ ts: '2026-06-10T02:00:00Z', provider: 'retrodiffusion', unitKind: 'credit', units: 7 }),
      'not json',
    ].join('\n')
    const g = await run({ [`${DATA}/usage.jsonl`]: usage }, { env: 'CLOUDFLARE_API_TOKEN=cf-secret\n' })
    const cf = g[2]?.items.find((i) => i.id === 'svc-cloudflare')
    expect(cf).toMatchObject({ status: 'online', subtitle: 'Còn 8500 neuron hôm nay' })
    expect(JSON.stringify(g)).not.toContain('cf-secret')
  })

  it('malformed run file is ignored', async () => {
    const files = {
      [`${DATA}/run/mcp-1.json`]: '{ nope',
      [`${DATA}/run/mcp-2.json`]: runFile(2),
      [`${DATA}/run/mcp-3.json.tmp`]: runFile(3),
      [`${DATA}/run/other.json`]: runFile(4),
    }
    const g = await run(files, { alive: [1, 2, 3, 4] })
    expect(g[0]?.items.map((i) => i.id)).toEqual(['claude-2'])
  })

  it('returns three groups in order with service states', async () => {
    const g = await run({}, { b: bridge({ mode: 'foreign' }), env: 'RETRO_DIFFUSION_API_KEY=rd-secret\n' })
    expect(g.map((x) => [x.id, x.label])).toEqual([
      ['claude', 'Claude Code'],
      ['tools', 'Công cụ'],
      ['services', 'Dịch vụ'],
    ])
    expect(g[2]?.items.map((i) => [i.id, i.status])).toEqual([
      ['svc-bridge', 'away'],
      ['svc-cloudflare', 'offline'],
      ['svc-retrodiffusion', 'online'],
    ])
    expect(JSON.stringify(g)).not.toContain('rd-secret')
  })

  it('reads only the last 2 MB of usage.jsonl', async () => {
    const old = JSON.stringify({
      ts: '2026-06-10T01:00:00Z',
      provider: 'cloudflare',
      unitKind: 'neuron',
      units: 9000,
    })
    const filler = `${'x'.repeat(100)}\n`.repeat(25_000) // ~2.5 MB
    const recent = JSON.stringify({
      ts: '2026-06-10T03:00:00Z',
      provider: 'cloudflare',
      unitKind: 'neuron',
      units: 100,
    })
    const g = await run(
      { [`${DATA}/usage.jsonl`]: `${old}\n${filler}${recent}\n` },
      { env: 'CLOUDFLARE_API_TOKEN=t\n' },
    )
    expect(g[2]?.items.find((i) => i.id === 'svc-cloudflare')?.subtitle).toBe('Còn 9900 neuron hôm nay')
  })
})
