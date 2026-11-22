#!/usr/bin/env node
/** Standalone bridge: lets Aseprite sync with Squarel projects without Claude Code running. */
import { createToolContext } from '../tools/context.ts'
import { BridgeServer, readBridgeToken } from './server.ts'

async function main() {
  const ctx = await createToolContext({ source: 'editor', logName: 'bridge' })
  const bridge = new BridgeServer(ctx, {
    port: ctx.config.bridgePort,
    token: readBridgeToken(ctx.config.dataDir),
  })
  ctx.editor = bridge
  if (!(await bridge.start())) {
    process.stderr.write(
      `Port ${ctx.config.bridgePort} is already in use (another bridge, or squarel-mcp inside Claude Code).\n`,
    )
    process.exit(1)
  }
  process.stderr.write(
    `Squarel bridge on ws://127.0.0.1:${bridge.port}/bridge\nData: ${ctx.config.dataDir}\nPress Ctrl+C to stop.\n`,
  )
  const stop = async () => {
    await bridge.stop()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((e) => {
  process.stderr.write(`bridge fatal: ${e?.stack ?? e}\n`)
  process.exit(1)
})
