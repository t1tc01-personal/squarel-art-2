#!/usr/bin/env node
/**
 * squarel CLI — run any tool from a terminal or script.
 *   squarel tools                         list tools
 *   squarel <tool> '{"json":"input"}'      run a tool (JSON input)
 *   squarel <tool> --key value ...         run a tool (flags; values parsed as JSON when possible)
 * Images in results are written next to the cwd as squarel-<tool>-N.png.
 */
import { writeFileSync } from 'node:fs'
import { createToolContext } from '../tools/context.ts'
import { ALL_TOOLS, runTool } from '../tools/registry.ts'
import { ToolError } from '../tools/types.ts'

function parseArgs(argv: string[]): Record<string, unknown> {
  if (argv.length === 1 && argv[0].trim().startsWith('{')) return JSON.parse(argv[0])
  const out: Record<string, unknown> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`unexpected argument "${a}"`)
    const key = a.slice(2).replace(/-/g, '_')
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
      continue
    }
    i++
    try {
      out[key] = JSON.parse(next)
    } catch {
      out[key] = next
    }
  }
  return out
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === 'tools') {
    console.log('Usage: squarel <tool> [json | --flags]\n\nTools:')
    for (const t of ALL_TOOLS) console.log(`  ${t.name.padEnd(20)} ${t.description.split('. ')[0]}`)
    return
  }
  const ctx = await createToolContext({
    source: 'cli',
    logName: 'cli',
    projectStart: process.env.SQUAREL_PROJECT_DIR || process.env.INIT_CWD || process.cwd(),
  })
  ctx.log = { debug() {}, info() {}, warn: (m) => console.error(m), error: (m) => console.error(m) }
  const input = parseArgs(rest)
  try {
    const r = await runTool(cmd, input, ctx)
    console.log(r.text)
    r.images?.forEach((im, n) => {
      const f = `squarel-${cmd}-${n + 1}.png`
      writeFileSync(f, im.png)
      console.log(`(image → ${f})`)
    })
  } catch (e) {
    const err = e instanceof ToolError ? e : new ToolError('INVALID', String(e))
    console.error(`[${err.code}] ${err.message}`)
    process.exitCode = 1
  }
}

main()
