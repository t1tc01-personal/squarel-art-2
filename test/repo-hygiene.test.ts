/**
 * The repository is public: make sure nothing secret or machine-specific can be committed.
 * Checks every tracked file plus every new file git would pick up (untracked, not ignored).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

function repoFiles(): string[] | null {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    return out.split('\0').filter(Boolean)
  } catch {
    return null // not a git checkout (e.g. a source zip): nothing to guard
  }
}

const files = repoFiles()
const SKIP_CONTENT = [/(^|\/)pnpm-lock\.yaml$/, /\.(png|gif|webp|gz|zip|aseprite|ico|exe)$/i]

/** Patterns that must never appear in committed text. */
const SECRET_PATTERNS: [string, RegExp][] = [
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|github_pat_[A-Za-z0-9_]{40,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  // a filled-in .env line (placeholders like <token> or empty values are fine)
  [
    'filled-in secret variable',
    /^[ \t]*(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|RETRO_DIFFUSION_API_KEY)[ \t]*=[ \t]*(?!<)[^\s<#]/m,
  ],
  ['Windows user profile path', /[A-Za-z]:[\\/]+Users[\\/]+(?!<|%|Public\b)[^\\/\s"'`]+[\\/]/],
]
const ALLOWED_EMAILS = [/@anthropic\.com$/, /@users\.noreply\.github\.com$/, /@example\.(com|org)$/]

describe.skipIf(!files)('repository hygiene (public repo)', () => {
  it('never tracks secrets, local data or personal build output', () => {
    const forbidden = files!.filter(
      (f) =>
        /(^|\/)\.env$/.test(f) ||
        /(^|\/)\.env\.(?!example$)[^/]+$/.test(f) ||
        f.startsWith('vendor/') ||
        f.endsWith('.aseprite-extension') ||
        /(^|\/)logs?\//.test(f) ||
        f.startsWith('evals/out/') ||
        /(^|\/)\.claude\/settings\.local\.json$/.test(f),
    )
    expect(forbidden).toEqual([])
  })

  it('.gitignore keeps the dangerous paths out', () => {
    const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8')
    for (const p of ['.env', 'vendor/', 'node_modules/']) expect(gi).toContain(p)
  })

  it('contains no keys, personal emails or user-profile paths', () => {
    const hits: string[] = []
    for (const f of files!) {
      if (SKIP_CONTENT.some((re) => re.test(f))) continue
      const full = join(ROOT, f)
      let text: string
      try {
        if (statSync(full).size > 2_000_000) continue
        text = readFileSync(full, 'utf8')
      } catch {
        continue // deleted in the working tree
      }
      if (f === 'test/repo-hygiene.test.ts') continue // the patterns themselves
      for (const [name, re] of SECRET_PATTERNS) if (re.test(text)) hits.push(`${f}: ${name}`)
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
        if (!ALLOWED_EMAILS.some((re) => re.test(m[0])))
          hits.push(`${f}: email ${m[0].replace(/^[^@]+/, '…')}`)
      }
    }
    expect(hits).toEqual([])
  })
})
