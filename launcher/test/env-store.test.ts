import { describe, expect, it } from 'vitest'
import { getVar, maskSecret, parseEnv, serializeEnv, setVar } from '../src/main/env-store'

describe('env store', () => {
  it('round-trips CRLF, BOM, comments and blank lines byte for byte', () => {
    const samples = [
      '\uFEFF# head\r\n\r\nA=1\r\n  # c\r\nB = two words\r\n\r\n',
      '# x\nA=1\n\n\nB=2',
      'A=1\n',
      '',
      '\uFEFF',
      '\r\n',
    ]
    for (const s of samples) expect(serializeEnv(parseEnv(s))).toBe(s)
    expect(parseEnv(samples[0] as string)).toMatchObject({ eol: '\r\n', bom: true })
  })

  it('setVar edits only the last occurrence of a duplicated key', () => {
    const doc = parseEnv('K=1\nX=9\nK=2\n')
    expect(getVar(doc, 'K')).toBe('2')
    expect(serializeEnv(setVar(doc, 'K', '3'))).toBe('K=1\nX=9\nK=3\n')
  })

  it("setVar appends a missing key with the file's line ending", () => {
    expect(serializeEnv(setVar(parseEnv('\uFEFFA=1\r\n'), 'B', '2'))).toBe('\uFEFFA=1\r\nB=2\r\n')
    expect(serializeEnv(setVar(parseEnv('A=1'), 'B', '2'))).toBe('A=1\nB=2')
    expect(serializeEnv(setVar(parseEnv(''), 'B', '2'))).toBe('B=2\n')
  })

  it('values with spaces, # and Vietnamese text survive', () => {
    const v = 'D:\\Dự án\\Squarel data'
    const doc = setVar(parseEnv('# note\r\n'), 'DATA_DIR', v)
    const back = parseEnv(serializeEnv(doc))
    expect(getVar(back, 'DATA_DIR')).toBe(v)
    expect(getVar(setVar(back, 'T', 'a # b = c'), 'T')).toBe('a # b = c')
    expect(getVar(parseEnv('# A=1\n'), 'A')).toBeUndefined()
  })

  it('maskSecret("abcd1234wxyz") === "••••wxyz"', () => {
    expect(maskSecret('abcd1234wxyz')).toBe('••••wxyz')
    expect(maskSecret(undefined)).toBe('')
    expect(maskSecret('')).toBe('')
  })

  it('rejects newlines in keys and values', () => {
    expect(() => setVar(parseEnv(''), 'A', 'x\ny')).toThrow()
    expect(() => setVar(parseEnv(''), 'A=B', 'x')).toThrow()
  })
})
