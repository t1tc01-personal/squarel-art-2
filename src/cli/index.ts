#!/usr/bin/env node
/**
 * squarel CLI — run any tool from a terminal or script.
 *   squarel tools                         list tools
 *   squarel <tool> '{"json":"input"}'      run a tool (JSON input)
 *   squarel <tool> --key value ...         run a tool (flags; values parsed as JSON when possible)
 * Images in results are written to <temp>/squarel-cli/<tool>-N.png (never into the project folder).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createToolContext } from '../tools/context.ts'
import { ALL_TOOLS, runTool } from '../tools/registry.ts'
import { ToolError } from '../tools/types.ts'
import { parseArgs } from './args.ts'

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
  const input = parseArgs(rest, ALL_TOOLS.find((t) => t.name === cmd)?.input)
  if (typeof input.art === 'string') ctx.session.activeProject = input.art
  try {
    const r = await runTool(cmd, input, ctx)
    console.log(r.text)
    r.images?.forEach((im, n) => {
      // Previews go to the temp folder, never into the user's project (cwd is often a project).
      const f = join(tmpdir(), 'squarel-cli', `${cmd}-${n + 1}.png`)
      mkdirSync(dirname(f), { recursive: true })
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
