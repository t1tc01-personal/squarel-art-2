import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface LauncherState {
  schema: 1
  squarelDir?: string
  mode?: 'fresh' | 'clone'
  setupStep: 1 | 2 | 3 | 4 | 'done'
  selected: string[]
  installChoice: Record<string, string>
  closeToTray: boolean
  autostart: boolean
  lastUpdateCheck?: string
  /** Set once the wizard reached "done"; a returning user skips steps 3–4 (main only). */
  setupCompleted?: boolean
}

const defaults = (): LauncherState => ({
  schema: 1,
  setupStep: 1,
  selected: [],
  installChoice: {},
  closeToTray: true,
  autostart: false,
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Missing, unreadable or corrupt files fall back to defaults; invalid fields are ignored. */
export async function loadState(file: string): Promise<LauncherState> {
  let raw: unknown
  try {
    raw = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''))
  } catch {
    return defaults()
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults()
  const r = raw as Record<string, unknown>
  if (r.schema !== 1) return defaults()
  const s = defaults()
  if (typeof r.squarelDir === 'string') s.squarelDir = r.squarelDir
  if (r.mode === 'fresh' || r.mode === 'clone') s.mode = r.mode
  if (
    r.setupStep === 1 ||
    r.setupStep === 2 ||
    r.setupStep === 3 ||
    r.setupStep === 4 ||
    r.setupStep === 'done'
  ) {
    s.setupStep = r.setupStep
  }
  if (Array.isArray(r.selected)) s.selected = r.selected.filter((x): x is string => typeof x === 'string')
  if (r.installChoice && typeof r.installChoice === 'object' && !Array.isArray(r.installChoice)) {
    for (const [k, v] of Object.entries(r.installChoice)) if (typeof v === 'string') s.installChoice[k] = v
  }
  if (typeof r.closeToTray === 'boolean') s.closeToTray = r.closeToTray
  if (typeof r.autostart === 'boolean') s.autostart = r.autostart
  if (typeof r.lastUpdateCheck === 'string') s.lastUpdateCheck = r.lastUpdateCheck
  if (r.setupCompleted === true) s.setupCompleted = true
  return s
}

/** Atomic write: temp file in the same directory, then rename (retrying transient Windows locks). */
export async function saveState(file: string, s: LauncherState): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmp, `${JSON.stringify(s, null, 2)}\n`, 'utf8')
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, file)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code
      if (i >= 20 || !code || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) {
        await rm(tmp, { force: true })
        throw e
      }
      await sleep(15 * (i + 1))
    }
  }
}
