/**
 * Secret redaction for text that leaves main (log lines, clipboard): the `.env` secret values,
 * credentials in URLs (`//user:pass@`), `Bearer <token>` and `token=`/`key=` query parameters.
 */
import { maskSecret } from './env-store'
import { maskCredentials } from './updates/tools'

const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi
const QUERY_SECRET = /([?&](?:token|key|api_key|apikey|access_token)=)[^&\s"']+/gi

export function redactText(text: string, secrets: readonly string[]): string {
  let out = maskCredentials(text)
  // Longest first, so a secret that contains another one is masked whole.
  for (const v of [...secrets].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length))
    out = out.split(v).join(maskSecret(v))
  return out.replace(BEARER, '$1 ••••').replace(QUERY_SECRET, '$1••••')
}
