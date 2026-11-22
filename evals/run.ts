/**
 * Image quality eval: run evals/prompts.json through a provider, report pixel-cleanliness metrics.
 *   pnpm eval -- --provider mock              (free, offline)
 *   pnpm eval -- --provider cloudflare --yes  (uses your free tier)
 *   pnpm eval -- --quality high --yes         (Retro Diffusion, PAID)
 * Output: evals/out/<timestamp>/report.md + one contact sheet per prompt. Uses a temporary DATA_DIR.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT } from '../src/config.ts'
import { silentLogger } from '../src/log.ts'
import { createToolContext } from '../src/tools/context.ts'
import { runTool } from '../src/tools/registry.ts'

const args = process.argv.slice(2)
const flag = (k: string) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true') : undefined
}
const provider = flag('provider') as 'mock' | 'cloudflare' | 'local-sd' | 'retrodiffusion' | undefined
const quality = (flag('quality') ?? 'free') as 'free' | 'high'
const variants = Number(flag('variants') ?? 2)
if (provider !== 'mock' && !flag('yes')) {
  console.error('This calls a real image API (may use quota or cost money). Re-run with --yes, or use --provider mock.')
  process.exit(1)
}

const prompts = JSON.parse(readFileSync(join(REPO_ROOT, 'evals', 'prompts.json'), 'utf8')) as {
  id: string
  prompt: string
  width: number
  height: number
  purpose: string
  palette?: string
}[]
const outDir = join(REPO_ROOT, 'evals', 'out', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(outDir, { recursive: true })
const dataDir = join(tmpdir(), `squarel-eval-${Date.now()}`)
const ctx = await createToolContext({ config: { dataDir }, log: silentLogger, source: 'cli' })

const rows: string[] = ['| id | provider | grid conf. (min/avg) | colors | warnings | cost |', '|---|---|---|---|---|---|']
let total = 0
for (const p of prompts) {
  try {
    await runTool('project_create', { name: p.id, width: p.width, height: p.height, purpose: p.purpose, palette: p.palette }, ctx)
    const r = await runTool(
      'generate_image',
      { prompt: p.prompt, variants, quality, provider, confirm_cost: quality === 'high', palette: p.palette ?? 'auto' },
      ctx,
    )
    const meta = r.data as { provider: string; costUsd: number; variants: { metrics: { gridConfidence: number; colorCount: number; warnings: string[] } }[] }
    const conf = meta.variants.map((v) => v.metrics.gridConfidence)
    total += meta.costUsd
    writeFileSync(join(outDir, `${p.id}.png`), r.images![0].png)
    rows.push(
      `| ${p.id} | ${meta.provider} | ${Math.min(...conf).toFixed(2)} / ${(conf.reduce((a, b) => a + b, 0) / conf.length).toFixed(2)} | ${meta.variants.map((v) => v.metrics.colorCount).join(', ')} | ${meta.variants.flatMap((v) => v.metrics.warnings).length} | $${meta.costUsd.toFixed(3)} |`,
    )
    console.log(`✓ ${p.id}`)
  } catch (e: any) {
    rows.push(`| ${p.id} | - | ERROR | | ${String(e.message).replace(/\|/g, '/')} | |`)
    console.log(`✗ ${p.id}: ${e.message}`)
  }
}
const report = `# Squarel eval ${new Date().toISOString()}\n\nprovider=${provider ?? 'default'} quality=${quality} variants=${variants} total cost ~$${total.toFixed(3)}\n\n${rows.join('\n')}\n\nContact sheets: one PNG per prompt in this folder. Score them by hand (clean grid? readable silhouette? palette ok?).\n`
writeFileSync(join(outDir, 'report.md'), report)
rmSync(dataDir, { recursive: true, force: true })
console.log(`\nReport: ${join(outDir, 'report.md')}`)
