/**
 * `lines` are raw segments: each keeps its own terminator ("\n" or "\r\n"), only the final
 * segment may lack one. This keeps mixed line endings byte-exact. `eol` is the dominant ending,
 * used for newly added lines.
 */
export interface EnvDoc {
  lines: string[]
  eol: '\r\n' | '\n'
  bom: boolean
}

export function parseEnv(text: string): EnvDoc {
  const bom = text.startsWith('\uFEFF')
  const body = bom ? text.slice(1) : text
  const lines = body === '' ? [] : body.split(/(?<=\n)/)
  const crlf = lines.filter((l) => l.endsWith('\r\n')).length
  const lf = lines.filter((l) => l.endsWith('\n') && !l.endsWith('\r\n')).length
  return { lines, eol: crlf > 0 && crlf >= lf ? '\r\n' : '\n', bom }
}

export function serializeEnv(doc: EnvDoc): string {
  return (doc.bom ? '\uFEFF' : '') + doc.lines.join('')
}

const LINE = /^(\s*(?:export[ \t]+)?)([^#=\s][^=]*?)\s*=(.*)$/s

/** Parses a `[export ]KEY=value` segment (terminator ignored); undefined for blanks, comments, no `=`. */
function parseLine(seg: string): { prefix: string; key: string; value: string; term: string } | undefined {
  const term = /\r?\n$/.exec(seg)?.[0] ?? ''
  const m = LINE.exec(seg.slice(0, seg.length - term.length))
  if (!m) return undefined
  return { prefix: m[1] as string, key: m[2] as string, value: m[3] as string, term }
}

function lastIndex(doc: EnvDoc, key: string): number {
  for (let i = doc.lines.length - 1; i >= 0; i--) if (parseLine(doc.lines[i] as string)?.key === key) return i
  return -1
}

export function getVar(doc: EnvDoc, key: string): string | undefined {
  const i = lastIndex(doc, key)
  return i < 0 ? undefined : parseLine(doc.lines[i] as string)?.value
}

export function setVar(doc: EnvDoc, key: string, value: string): EnvDoc {
  if (/[\r\n]/.test(key) || /[\r\n]/.test(value) || key.trim() === '' || key.includes('=')) {
    throw new Error('invalid .env key or value')
  }
  const lines = [...doc.lines]
  const i = lastIndex(doc, key)
  if (i >= 0) {
    const p = parseLine(lines[i] as string)
    lines[i] = `${p?.prefix}${key}=${value}${p?.term}`
  } else {
    const last = lines.length - 1
    if (last >= 0 && !/\n$/.test(lines[last] as string)) {
      lines[last] += doc.eol
      lines.push(`${key}=${value}`) // file had no trailing newline: keep it that way
    } else {
      lines.push(`${key}=${value}${doc.eol}`)
    }
  }
  return { ...doc, lines }
}

/** Last 4 characters only for secrets of 8+ characters; shorter ones are fully masked. */
export function maskSecret(v: string | undefined): string {
  if (!v) return ''
  return v.length >= 8 ? `\u2022\u2022\u2022\u2022${v.slice(-4)}` : '\u2022\u2022\u2022\u2022'
}
