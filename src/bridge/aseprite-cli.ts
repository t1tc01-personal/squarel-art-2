import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../config.ts'

export const ASEPRITE_DIR = join(REPO_ROOT, 'integrations', 'aseprite')
export const CLI_SCRIPTS = {
  docToAseprite: join(ASEPRITE_DIR, 'cli', 'doc-to-aseprite.lua'),
  asepriteToDoc: join(ASEPRITE_DIR, 'cli', 'aseprite-to-doc.lua'),
}

export function asepriteAvailable(path?: string): path is string {
  return Boolean(path && existsSync(path))
}

/** Run Aseprite in batch mode with a script and params. */
export function runAsepriteScript(
  asepritePath: string,
  script: string,
  params: Record<string, string>,
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string }> {
  const args = ['-b']
  for (const [k, v] of Object.entries({ dir: join(ASEPRITE_DIR, 'squarel'), ...params }))
    args.push('--script-param', `${k}=${v}`)
  args.push('--script', script)
  return new Promise((resolve, reject) => {
    execFile(asepritePath, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`aseprite failed: ${err.message}\n${stderr}`))
      else resolve({ stdout, stderr })
    })
  })
}

/** Launch the Aseprite GUI detached with a file. */
export function launchAseprite(asepritePath: string, file: string): void {
  const child = spawn(asepritePath, [file], { detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
}
