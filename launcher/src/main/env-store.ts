export interface EnvDoc {
  lines: string[]
  eol: '\r\n' | '\n'
  bom: boolean
}

export function parseEnv(text: string): EnvDoc {
  const bom = text.startsWith('﻿')
  const body = bom ? text.slice(1) : text
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  return { lines: body.split(eol), eol, bom }
}

export function serializeEnv(doc: EnvDoc): string {
  return (doc.bom ? '﻿' : '') + doc.lines.join(doc.eol)
}

/** Key of a `KEY=value` line, or undefined for blanks, comments and lines without `=`. */
function keyOf(line: string): string | undefined {
  const t = line.trimStart()
  if (t === '' || t.startsWith('#')) return undefined
  const i = t.indexOf('=')
  if (i < 0) return undefined
  const key = t.slice(0, i).trim()
  return key === '' ? undefined : key
}

function lastIndex(doc: EnvDoc, key: string): number {
  for (let i = doc.lines.length - 1; i >= 0; i--) if (keyOf(doc.lines[i] as string) === key) return i
  return -1
}

export function getVar(doc: EnvDoc, key: string): string | undefined {
  const i = lastIndex(doc, key)
  if (i < 0) return undefined
  const line = (doc.lines[i] as string).trimStart()
  return line.slice(line.indexOf('=') + 1)
}

export function setVar(doc: EnvDoc, key: string, value: string): EnvDoc {
  if (/[\r\n]/.test(key) || /[\r\n]/.test(value) || key.trim() === '' || key.includes('=')) {
    throw new Error('invalid .env key or value')
  }
  const lines = [...doc.lines]
  const i = lastIndex(doc, key)
  const entry = `${key}=${value}`
  if (i >= 0) {
    lines[i] = entry
  } else if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.splice(lines.length - 1, 0, entry) // keep the trailing newline
  } else {
    lines.push(entry)
  }
  return { ...doc, lines }
}

export function maskSecret(v: string | undefined): string {
  if (!v) return ''
  return `••••${v.slice(-4)}`
}
