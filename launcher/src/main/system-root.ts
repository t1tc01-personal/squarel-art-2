/**
 * The Windows folder, for programs the launcher runs from System32 (cmd.exe, taskkill, tasklist,
 * PowerShell). Only a plain drive path is trusted: a SystemRoot that is relative, a UNC path, or
 * holds `"` or `%` (quoting / expansion inside cmd) falls back to C:\Windows. ComSpec and PATH are
 * never used to find these programs.
 */
import { win32 } from 'node:path'

const SAFE_ROOT = /^[A-Za-z]:\\[^"%]*$/

function envGet(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const k = Object.keys(env).find((x) => x.toUpperCase() === key.toUpperCase())
  return k ? env[k] : undefined
}

export function systemRoot(env: NodeJS.ProcessEnv): string {
  const root = envGet(env, 'SystemRoot')
  return root && SAFE_ROOT.test(root) ? root : 'C:\\Windows'
}

/** `<systemRoot>\System32\<parts…>`. */
export function system32(env: NodeJS.ProcessEnv, ...parts: string[]): string {
  return win32.join(systemRoot(env), 'System32', ...parts)
}
