/**
 * Secret redaction for text that leaves main (log lines, clipboard): the `.env` secret values,
 * credentials in URLs (`//user:pass@`), `Authorization: <scheme> <x>`, `Bearer <x>`, and any
 * `key: value` / `key=value` whose key looks secret (same key rule as Squarel's src/log.ts).
 */
import { maskSecret } from './env-store'
import { maskCredentials } from './updates/tools'

/** Key names whose values are secrets (src/log.ts SECRET_KEYS). */
export const SECRET_KEY = /token|key|secret|authorization|password/i

const MASK = '••••'
const AUTH_HEADER =
  /\b(authorization)("?\s*[:=]\s*"?)(?:(Basic|Bearer|Digest|Token|Negotiate|NTLM|ApiKey)\s+)?([^\s"',;&]+)/gi
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi
/** `apiKey=x`, `token: x`, `"secret":"x"`, `?access_token=x` (authorization is handled above). */
const KEY_VALUE = /\b([\w-]*(?:token|key|secret|password)[\w-]*)("?\s*[:=]\s*"?)([^\s"',;&]+)/gi

export function redactText(text: string, secrets: readonly string[]): string {
  let out = maskCredentials(text)
  // Longest first, so a secret that contains another one is masked whole.
  for (const v of [...secrets].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length))
    out = out.split(v).join(maskSecret(v))
  return out
    .replace(AUTH_HEADER, (_m, k: string, sep: string, scheme: string | undefined) =>
      scheme ? `${k}${sep}${scheme} ${MASK}` : `${k}${sep}${MASK}`,
    )
    .replace(BEARER, `$1 ${MASK}`)
    .replace(KEY_VALUE, `$1$2${MASK}`)
}

/** Deep copy with the value of every secret-looking key replaced by `[redacted]`. */
export function redactKeys(v: unknown, depth = 0): unknown {
  if (!v || typeof v !== 'object' || depth > 20) return v
  if (Array.isArray(v)) return v.map((x) => redactKeys(x, depth + 1))
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) => [
      k,
      SECRET_KEY.test(k) ? '[redacted]' : redactKeys(x, depth + 1),
    ]),
  )
}
