import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bridgeMode, type McpPresence, presenceFile, startPresence } from '../src/mcp/presence.ts'
import { tempDir } from './helpers.ts'

let t: ReturnType<typeof tempDir>
beforeEach(() => {
  t = tempDir()
})
afterEach(() => t.cleanup())

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as McpPresence
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('bridgeMode', () => {
  it('own / shared / none, and none when start() threw', () => {
    expect(bridgeMode({ disabled: false, up: true, startThrew: false })).toBe('own')
    expect(bridgeMode({ disabled: false, up: false, startThrew: false })).toBe('shared')
    expect(bridgeMode({ disabled: false, up: false, startThrew: true })).toBe('none')
    expect(bridgeMode({ disabled: true, up: false, startThrew: false })).toBe('none')
  })
})

describe('mcp presence', () => {
  it('writes run/mcp-<pid>.json at start with bridge mode and cwd', async () => {
    const p = startPresence({ dataDir: t.dir, version: '1.2.3', bridge: 'own', intervalMs: 100000 })
    await sleep(300)
    const file = presenceFile(t.dir)
    expect(file).toBe(join(t.dir, 'run', `mcp-${process.pid}.json`))
    const doc = read(file)
    expect(doc).toMatchObject({ pid: process.pid, cwd: process.cwd(), version: '1.2.3', bridge: 'own' })
    expect(doc.startedAt).toBeTruthy()
    expect(doc.lastTool).toBeUndefined()
    await p.stop()
  })

  it('touch() records lastTool and rewrites immediately', async () => {
    let now = new Date('2026-01-01T00:00:00Z')
    const p = startPresence({
      dataDir: t.dir,
      version: '1',
      bridge: 'none',
      intervalMs: 100000,
      now: () => now,
    })
    await sleep(300)
    now = new Date('2026-01-01T00:00:05Z')
    p.touch('draw_pixels')
    await sleep(300)
    const doc = read(presenceFile(t.dir))
    expect(doc.lastTool).toBe('draw_pixels')
    expect(doc.lastToolAt).toBe('2026-01-01T00:00:05.000Z')
    expect(doc.updatedAt).toBe('2026-01-01T00:00:05.000Z')
    expect(doc.startedAt).toBe('2026-01-01T00:00:00.000Z')
    await p.stop()
  })

  it('heartbeat rewrites updatedAt every intervalMs', async () => {
    const p = startPresence({ dataDir: t.dir, version: '1', bridge: 'shared', intervalMs: 20 })
    await sleep(300)
    const first = read(presenceFile(t.dir)).updatedAt
    await sleep(300)
    const later = read(presenceFile(t.dir)).updatedAt
    expect(Date.parse(later)).toBeGreaterThan(Date.parse(first))
    await p.stop()
  })

  it('stop() removes only its own file and is safe to call twice', async () => {
    const other = presenceFile(t.dir, 999999)
    const a = startPresence({ dataDir: t.dir, version: '1', bridge: 'own', intervalMs: 100000, pid: 999999 })
    await a.stop()
    const b = startPresence({ dataDir: t.dir, version: '1', bridge: 'own', intervalMs: 100000, pid: 4242 })
    const c = startPresence({ dataDir: t.dir, version: '1', bridge: 'own', intervalMs: 100000, pid: 4243 })
    await sleep(300)
    expect(existsSync(presenceFile(t.dir, 4242))).toBe(true)
    await b.stop()
    await b.stop()
    expect(existsSync(presenceFile(t.dir, 4242))).toBe(false)
    expect(existsSync(presenceFile(t.dir, 4243))).toBe(true)
    expect(existsSync(other)).toBe(false)
    await c.stop()
  })

  it('stop() leaves a foreign pid file alone', async () => {
    const foreign = presenceFile(t.dir, 999999)
    const f = startPresence({ dataDir: t.dir, version: '1', bridge: 'none', intervalMs: 100000, pid: 999999 })
    await sleep(300)
    const mine = startPresence({ dataDir: t.dir, version: '1', bridge: 'none', intervalMs: 100000 })
    await sleep(300)
    await mine.stop()
    expect(existsSync(foreign)).toBe(true)
    expect(existsSync(presenceFile(t.dir))).toBe(false)
    await f.stop()
  })

  it('two instances with different pids keep separate files', async () => {
    const a = startPresence({ dataDir: t.dir, version: '1', bridge: 'own', intervalMs: 100000, pid: 111 })
    const b = startPresence({ dataDir: t.dir, version: '1', bridge: 'shared', intervalMs: 100000, pid: 222 })
    await sleep(300)
    a.touch('canvas_view')
    await sleep(300)
    expect(read(presenceFile(t.dir, 111))).toMatchObject({ pid: 111, bridge: 'own', lastTool: 'canvas_view' })
    expect(read(presenceFile(t.dir, 222))).toMatchObject({ pid: 222, bridge: 'shared' })
    expect(read(presenceFile(t.dir, 222)).lastTool).toBeUndefined()
    await a.stop()
    await b.stop()
  })
})
