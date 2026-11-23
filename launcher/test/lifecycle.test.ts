import { describe, expect, it } from 'vitest'
import { createQuitController, type QuitDeps } from '../src/main/lifecycle'
import {
  clearOwnRecord,
  isOurBridge,
  type OrphanDeps,
  type OwnerRecord,
  type ProcInfo,
  recordOwnBridge,
  recoverOrphanBridge,
} from '../src/main/orphan'

const tick = () => new Promise((r) => setTimeout(r, 0))

function quitHarness(over: Partial<QuitDeps> = {}, opts: { stopDeadlineMs?: number } = {}) {
  const calls: string[] = []
  let releaseStop: (() => void) | undefined
  const deps: QuitDeps = {
    runningTasks: () => [],
    confirmStopTasks: async () => true,
    beginQuit: () => void calls.push('begin'),
    abortTasks: async () => void calls.push('abort'),
    stopBackgroundWork: () => void calls.push('background'),
    stopBridge: () =>
      new Promise<void>((r) => {
        calls.push('stop')
        releaseStop = () => {
          calls.push('stopped')
          r()
        }
      }),
    killOwnChild: () => void calls.push('kill'),
    quit: () => void calls.push('quit'),
    ...over,
  }
  const q = createQuitController(deps, opts)
  const event = () => {
    let prevented = false
    return {
      preventDefault: () => {
        prevented = true
      },
      get prevented() {
        return prevented
      },
    }
  }
  return { q, calls, event, release: () => releaseStop?.() }
}

describe('quit sequencing', () => {
  it('before-quit waits for the bridge to stop (once) before quitting', async () => {
    const { q, calls, event, release } = quitHarness()
    const e1 = event()
    q.beforeQuit(e1)
    expect(e1.prevented).toBe(true)
    await tick()
    // A second quit request while stopping is held back and does not stop again.
    const e2 = event()
    q.beforeQuit(e2)
    expect(e2.prevented).toBe(true)
    await tick()
    expect(calls).toEqual(['begin', 'background', 'stop'])
    release()
    await tick()
    await tick()
    expect(calls).toEqual(['begin', 'background', 'stop', 'stopped', 'quit'])
    // The real quit that follows passes through.
    const e3 = event()
    q.beforeQuit(e3)
    expect(e3.prevented).toBe(false)
    expect(calls.filter((c) => c === 'stop')).toHaveLength(1)
    expect(q.quitting).toBe(true)
  })

  it('a failing bridge stop still quits', async () => {
    const { q, calls, event } = quitHarness({
      stopBridge: async () => {
        throw new Error('boom')
      },
    })
    q.beforeQuit(event())
    await tick()
    await tick()
    expect(calls).toContain('quit')
  })

  it('process exit kills only the own child, synchronously', () => {
    const { q, calls } = quitHarness()
    q.exit()
    expect(calls).toEqual(['kill'])
  })

  it('running tasks: asks first; cancel keeps the app, confirm aborts them before stopping', async () => {
    let answer = false
    const asked: string[][] = []
    const { q, calls, event, release } = quitHarness({
      runningTasks: () => ['Aseprite đang build…'],
      confirmStopTasks: async (labels) => {
        asked.push(labels)
        return answer
      },
    })
    q.beforeQuit(event())
    await tick()
    await tick()
    expect(asked).toEqual([['Aseprite đang build…']])
    expect(calls).toEqual([])
    expect(q.quitting).toBe(false)

    answer = true
    q.beforeQuit(event())
    await tick()
    await tick()
    // beginQuit comes before the abort, so a task's bridge resume cannot respawn a bridge.
    expect(calls).toEqual(['begin', 'abort', 'background', 'stop'])
    release()
    await tick()
    await tick()
    expect(calls.at(-1)).toBe('quit')
  })

  it('shutdown(finish) runs the same stop, then finish instead of quit (self-update install)', async () => {
    const { q, calls, release } = quitHarness()
    const done = q.shutdown(() => void calls.push('install'))
    await tick()
    release()
    expect(await done).toBe(true)
    expect(calls).toEqual(['begin', 'background', 'stop', 'stopped', 'install'])
  })

  it('a bridge stop that never settles is cut off: own child killed, quit anyway', async () => {
    const { q, calls, event } = quitHarness(
      { stopBridge: () => new Promise<void>(() => {}) },
      { stopDeadlineMs: 20 },
    )
    q.beforeQuit(event())
    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toEqual(['begin', 'background', 'kill', 'quit'])
    expect(q.quitting).toBe(true)
  })

  it('an install requested while a quit is pending still installs (strongest finish wins)', async () => {
    const { q, calls, event, release } = quitHarness()
    q.beforeQuit(event())
    await tick()
    const install = q.shutdown(() => void calls.push('install'))
    // A later plain quit does not downgrade it again.
    q.beforeQuit(event())
    release()
    expect(await install).toBe(true)
    expect(calls).toEqual(['begin', 'background', 'stop', 'stopped', 'install'])
  })
})

const NOW = new Date('2026-01-01T12:00:00.000Z')
const REC: OwnerRecord = { pid: 4242, port: 4321, startedAt: NOW.toISOString() }
const NODE: ProcInfo = {
  image: 'C:\\Program Files\\nodejs\\node.exe',
  commandLine: '"C:\\Program Files\\nodejs\\node.exe" src/bridge/index.ts',
  createdAt: new Date(NOW.getTime() - 200),
}

function orphanHarness(over: { file?: string; alive?: boolean; info?: ProcInfo | undefined } = {}) {
  let file: string | undefined = over.file
  const killed: number[] = []
  const deps: OrphanDeps = {
    read: async () => file,
    write: async (t) => {
      file = t
    },
    remove: async () => {
      file = undefined
    },
    isPidAlive: () => over.alive ?? true,
    procInfo: async () => ('info' in over ? over.info : NODE),
    kill: async (pid) => void killed.push(pid),
  }
  return { deps, killed, file: () => file }
}

describe('orphan bridge recovery', () => {
  it('isOurBridge needs node + the bridge entry + a matching start time', () => {
    expect(isOurBridge(REC, NODE)).toBe(true)
    expect(isOurBridge(REC, { ...NODE, commandLine: 'node src\\bridge\\index.ts' })).toBe(true)
    expect(isOurBridge(REC, { ...NODE, image: 'C:\\x\\aseprite.exe' })).toBe(false)
    expect(isOurBridge(REC, { ...NODE, commandLine: 'node src/mcp/index.ts' })).toBe(false)
    // pid reused by a later process / unknown start time: not provably ours.
    expect(isOurBridge(REC, { ...NODE, createdAt: new Date(NOW.getTime() + 3_600_000) })).toBe(false)
    expect(isOurBridge(REC, { image: NODE.image, commandLine: NODE.commandLine })).toBe(false)
  })

  it('no record → nothing to do', async () => {
    const h = orphanHarness()
    expect(await recoverOrphanBridge(h.deps)).toBe('none')
  })

  it('dead pid → record removed, nothing killed', async () => {
    const h = orphanHarness({ file: JSON.stringify(REC), alive: false })
    expect(await recoverOrphanBridge(h.deps)).toBe('gone')
    expect(h.killed).toEqual([])
    expect(h.file()).toBeUndefined()
  })

  it('alive and provably ours → killed', async () => {
    const h = orphanHarness({ file: JSON.stringify(REC) })
    expect(await recoverOrphanBridge(h.deps)).toBe('killed')
    expect(h.killed).toEqual([4242])
    expect(h.file()).toBeUndefined()
  })

  it('alive but not provably ours → left alone', async () => {
    const h = orphanHarness({ file: JSON.stringify(REC), info: { ...NODE, commandLine: 'node other.js' } })
    expect(await recoverOrphanBridge(h.deps)).toBe('not-ours')
    expect(h.killed).toEqual([])
    expect(h.file()).toBeUndefined()
  })

  it('process query failed → unknown: record kept, nothing killed', async () => {
    const h = orphanHarness({ file: JSON.stringify(REC), info: undefined })
    expect(await recoverOrphanBridge(h.deps)).toBe('unknown')
    expect(h.killed).toEqual([])
    expect(h.file()).toBe(JSON.stringify(REC))
  })

  it('clearOwnRecord removes the record only for that pid once it is dead', async () => {
    const alive = orphanHarness({ file: JSON.stringify(REC), alive: true })
    await clearOwnRecord(alive.deps, 4242)
    expect(alive.file()).toBeDefined() // still running: the next start recovers it
    const other = orphanHarness({ file: JSON.stringify(REC), alive: false })
    await clearOwnRecord(other.deps, 99)
    expect(other.file()).toBeDefined()
    const dead = orphanHarness({ file: JSON.stringify(REC), alive: false })
    await clearOwnRecord(dead.deps, 4242)
    expect(dead.file()).toBeUndefined()
  })

  it('corrupt record → removed, nothing killed', async () => {
    for (const bad of ['{', '{"pid":"1"}', '{"pid":0,"port":1,"startedAt":"x"}', '{"pid":-5}']) {
      const h = orphanHarness({ file: bad })
      expect(await recoverOrphanBridge(h.deps)).toBe('none')
      expect(h.killed).toEqual([])
      expect(h.file()).toBeUndefined()
    }
  })

  it('recordOwnBridge writes the pid on spawn and clears it when that child exits', async () => {
    const h = orphanHarness()
    let exit: (() => void) | undefined
    const exited = new Promise<{ code: number | null; stderr: string }>((r) => {
      exit = () => r({ code: 0, stderr: '' })
    })
    await recordOwnBridge(h.deps, { pid: 77, exited }, 4321, NOW)
    expect(JSON.parse(h.file() as string)).toEqual({ pid: 77, port: 4321, startedAt: NOW.toISOString() })
    exit?.()
    await tick()
    await tick()
    expect(h.file()).toBeUndefined()
  })

  it('a child exiting does not clear the record of a newer child', async () => {
    const h = orphanHarness()
    let exitOld: (() => void) | undefined
    const old = new Promise<{ code: number | null; stderr: string }>((r) => {
      exitOld = () => r({ code: 1, stderr: '' })
    })
    await recordOwnBridge(h.deps, { pid: 1, exited: old }, 4321, NOW)
    await recordOwnBridge(h.deps, { pid: 2, exited: new Promise(() => {}) }, 4321, NOW)
    exitOld?.()
    await tick()
    await tick()
    expect(JSON.parse(h.file() as string).pid).toBe(2)
  })
})

describe('parseProcInfo', () => {
  it('reads the PowerShell JSON line; anything else is unknown', async () => {
    const { parseProcInfo } = await import('../src/main/orphan')
    expect(
      parseProcInfo(
        '{"image":"C:\\nodejs\\node.exe","cmd":"node src/bridge/index.ts","created":"2026-01-01T11:59:59.8000000Z"}',
      ),
    ).toEqual({
      image: 'C:\nodejs\node.exe',
      commandLine: 'node src/bridge/index.ts',
      createdAt: new Date('2026-01-01T11:59:59.800Z'),
    })
    expect(parseProcInfo('{"image":null,"cmd":null}')).toBeUndefined()
    expect(parseProcInfo('not json')).toBeUndefined()
    expect(parseProcInfo('{"image":"node.exe","cmd":"x","created":"bogus"}')).toEqual({
      image: 'node.exe',
      commandLine: 'x',
    })
  })
})
