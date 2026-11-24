/** Runs every health check in parallel; a throwing check becomes a fail result. Never calls paid APIs. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CheckResult } from '../../shared/model'
import type { Deps } from '../deps'
import type { Registry } from '../registry/registry'
import { resolveExecutable } from '../run'
import * as B from './builtin'

export type { CheckCtx } from './builtin'

const SMOKE_TIMEOUT_MS = 15_000

export async function smokeTestMcp(
  squarelDir: string,
  d: Deps,
  opts: { dataDir: string; timeoutMs?: number },
): Promise<{ ok: boolean; tools: number; ms: number; error?: string }> {
  const t0 = performance.now()
  const ms = () => Math.round(performance.now() - t0)
  const node = resolveExecutable('node', d.env)
  if (!node) return { ok: false, tools: 0, ms: ms(), error: 'không tìm thấy Node trên PATH' }
  const transport = new StdioClientTransport({
    command: node.path,
    args: [join(squarelDir, 'src', 'mcp', 'index.ts')],
    cwd: squarelDir,
    env: { SQUAREL_NO_BRIDGE: '1', DATA_DIR: opts.dataDir },
    stderr: 'ignore',
  })
  const client = new Client({ name: 'squarel-launcher-health', version: '1.0.0' })
  let timer: NodeJS.Timeout | undefined
  try {
    const work = (async () => {
      await client.connect(transport)
      return (await client.listTools()).tools.length
    })()
    work.catch(() => {}) // a late rejection after the timeout must not be unhandled
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(
        () => rej(new Error('quá thời gian chờ, server không phản hồi')),
        opts.timeoutMs ?? SMOKE_TIMEOUT_MS,
      )
    })
    const tools = await Promise.race([work, timeout])
    return { ok: true, tools, ms: ms() }
  } catch (e) {
    return { ok: false, tools: 0, ms: ms(), error: String((e as Error)?.message ?? e) }
  } finally {
    if (timer) clearTimeout(timer)
    await client.close().catch(() => {})
    await transport.close().catch(() => {})
  }
}

/** Smoke test with a throwaway DATA_DIR so no presence file or log shows up in the user's data. */
async function realSmoke(squarelDir: string, d: Deps) {
  const dataDir = await mkdtemp(join(tmpdir(), 'squarel-health-'))
  try {
    return await smokeTestMcp(squarelDir, d, { dataDir })
  } finally {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {})
  }
}

interface Def {
  id: string
  group: string
  label: string
  description: string
  builtin?: string
  run: () => Promise<B.Draft> | B.Draft
}

/**
 * Checks that only run when the user asks (button, wizard), never on the schedule:
 * `claude mcp list` starts every MCP server the user configured in Claude Code.
 */
export const ON_DEMAND_CHECKS: readonly string[] = ['claude-sees-squarel']

/**
 * `only`: run just these check ids (the setup wizard verifies one thing at a time).
 * `skip`: never run these; a result for the same id in `previous` takes their place.
 */
export async function runChecks(
  reg: Registry,
  ctx: B.CheckCtx,
  d: Deps,
  only?: readonly string[],
  opts: { skip?: readonly string[]; previous?: readonly CheckResult[] } = {},
): Promise<CheckResult[]> {
  const smoke = ctx.smoke ?? realSmoke
  const defs: Def[] = [
    {
      id: 'claude-installed',
      group: 'claude',
      label: 'Claude Code đã cài',
      description: 'claude --version chạy được.',
      run: () => B.claudeInstalled(d),
    },
    {
      id: 'claude-sees-squarel',
      group: 'claude',
      label: 'Claude Code thấy server "squarel"',
      description: 'claude mcp list báo Connected. Chỉ chạy khi bạn bấm kiểm tra, không chạy theo lịch.',
      run: () => B.claudeSeesSquarel(d, ctx),
    },
    {
      id: 'claude-skills',
      group: 'claude',
      label: 'Skill /pixel-new, /pixel-export… trong Claude Code',
      description: 'Các skill pixel-* nằm trong ~/.claude/skills và khớp với thư mục Squarel.',
      run: () => B.claudeSkills(d, ctx),
    },
    {
      id: 'squarel-version',
      group: 'claude',
      label: 'Squarel cùng phiên bản với launcher',
      description: 'Squarel cũ hơn launcher thì Claude không thấy Dự án và art lưu sai chỗ.',
      run: () => B.squarelVersion(d, ctx),
    },
    {
      id: 'mcp-starts',
      group: 'claude',
      label: 'MCP server khởi động',
      description: 'Khởi động qua stdio như Claude Code, đọc danh sách tool.',
      run: () => B.mcpStarts(d, ctx, smoke),
    },
    {
      id: 'bridge-listening',
      group: 'bridge',
      label: `Bridge nghe cổng ${ctx.bridge.port}`,
      description: 'Do launcher giữ; MCP server dùng chung.',
      run: () => B.bridgeListening(ctx.bridge),
    },
  ]
  for (const i of reg.integrations) {
    if (!ctx.selected.includes(i.manifest.id) || i.incompatible) continue
    for (const c of i.manifest.checks) {
      if (c.manual) continue
      defs.push({
        id: `integration:${i.manifest.id}:${c.id}`,
        group: `integration:${i.manifest.id}`,
        label: c.label,
        ...(c.builtin ? { builtin: c.builtin } : {}),
        description:
          (c.builtin && B.BUILTIN_DESC[c.builtin]) ||
          `Chạy ${c.run?.join(' ') ?? c.id}, đạt khi mã thoát là 0.`,
        run: () => B.integrationCheck(i, c, ctx, d),
      })
    }
  }
  defs.push(
    {
      id: 'cloudflare-token',
      group: 'ai',
      label: 'Token Cloudflare hợp lệ',
      description: 'Endpoint kiểm tra token, không tốn neuron.',
      run: () => B.cloudflareToken(d, ctx.env),
    },
    {
      id: 'retrodiffusion-key',
      group: 'ai',
      label: 'Retro Diffusion',
      description: 'Không bắt buộc. Chỉ cần khi dùng chất lượng cao.',
      run: () => B.retroDiffusionKey(ctx.env),
    },
    {
      id: 'data-dir-writable',
      group: 'machine',
      label: 'Thư mục dữ liệu ghi được',
      description: 'DATA_DIR tồn tại và ghi thử thành công.',
      run: () => B.dataDirWritable(d, ctx.dataDir),
    },
    {
      id: 'disk-space',
      group: 'machine',
      label: 'Dung lượng đĩa',
      description: 'Cần tối thiểu 2GB cho project và bản build.',
      run: () => B.diskSpace(d, ctx.dataDir),
    },
  )
  const results = await Promise.all(
    defs
      .filter((x) => !only || only.includes(x.id))
      .map(async ({ run, ...meta }): Promise<CheckResult | undefined> => {
        if (opts.skip?.includes(meta.id)) return opts.previous?.find((r) => r.id === meta.id)
        try {
          const r = await run()
          return {
            ...meta,
            ...r,
            label: r.label ?? meta.label,
            description: r.description ?? meta.description,
          }
        } catch (e) {
          return {
            ...meta,
            result: 'fail',
            detail: `Lỗi khi kiểm tra: ${String((e as Error)?.message ?? e)}`,
          }
        }
      }),
  )
  return results.filter((r): r is CheckResult => r !== undefined)
}
