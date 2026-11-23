import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeps } from '../src/main/deps'
import { MAX_TOTAL_BYTES, parseLogLine, pruneLauncherLogs, readLogs } from '../src/main/logs'
import { redactText } from '../src/main/redact'

const DIR = resolve(tmpdir(), 'squarel-logs-test', 'logs')
const line = (o: object) => `${JSON.stringify(o)}\n`
const red = (t: string) => redactText(t, [])

describe('log redaction', () => {
  it('masks secret-looking JSON keys that are not in .env, at any depth', () => {
    const p = parseLogLine(
      JSON.stringify({
        ts: '2026-01-01T00:00:00Z',
        level: 'info',
        name: 'mcp',
        msg: 'call',
        apiKey: 'placeholder-api-key-value',
        req: { headers: { Authorization: 'Basic placeholder-basic' }, password: 'pw-placeholder' },
      }),
      'mcp',
    )
    expect(p.text).not.toContain('placeholder-api-key-value')
    expect(p.text).not.toContain('placeholder-basic')
    expect(p.text).not.toContain('pw-placeholder')
    expect(p.text).toContain('apiKey=[redacted]')
  })

  it('masks Authorization headers and key: value / key=value text', () => {
    expect(red('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: Basic ••••')
    expect(red('authorization=rawvalue next')).toBe('authorization=••••')
    expect(red('Authorization: OAuth abc123secret')).toBe('Authorization: ••••')
    expect(red('Authorization: AWS4-HMAC-SHA256 Credential=x, Signature=deadbeef')).not.toContain('deadbeef')
    expect(red('{"Authorization":"Weird s3cr3t-value","x":1}')).toBe('{"Authorization":"••••","x":1}')
    expect(red('password: "my long pass"')).toBe('password: "••••"')
    expect(red('api_key: abc123 and token=xyz&a=1')).toBe('api_key: •••• and token=••••&a=1')
    expect(red('{"clientSecret":"s3cr3t"}')).toBe('{"clientSecret":"••••"}')
    expect(red('2026-01-01T10:00:01Z editor hello')).toBe('2026-01-01T10:00:01Z editor hello')
  })

  it('redacts the whole line, timestamp included', async () => {
    const d = createDeps('fake', {
      files: { [join(DIR, 'odd.log')]: line({ ts: 'token=leaky', msg: 'x' }) },
    })
    const r = await readLogs([DIR], {}, red, d)
    expect(JSON.stringify(r)).not.toContain('leaky')
  })
})

describe('log reading limits', () => {
  it('reads newest files first, caps the bytes and keeps the newest lines', async () => {
    const files: Record<string, string> = {}
    // 30 days × ~300 KB: far more than the 4 MB budget.
    for (let day = 1; day <= 30; day++) {
      const date = `2026-01-${String(day).padStart(2, '0')}`
      let text = ''
      for (let i = 0; i < 1500; i++)
        text += line({
          ts: `${date}T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
          level: 'info',
          name: 'bridge',
          msg: `day ${day} line ${i} ${'x'.repeat(150)}`,
        })
      files[join(DIR, `bridge-${date}.log`)] = text
    }
    const d = createDeps('fake', { files })
    let bytes = 0
    const open = d.fs.open.bind(d.fs)
    d.fs.open = (async (p: string, f: string) => {
      const fh = await open(p, f)
      return {
        ...fh,
        read: async (...a: Parameters<typeof fh.read>) => {
          const r = await fh.read(...a)
          bytes += r.bytesRead
          return r
        },
        close: () => fh.close(),
      }
    }) as typeof d.fs.open
    const r = await readLogs([DIR], {}, red, d)
    expect(r.lines).toHaveLength(500)
    expect(r.lines.at(-1)?.text).toContain('day 30 line 1499')
    expect(r.lines.every((l) => l.ts.startsWith('2026-01-30'))).toBe(true)
    expect(bytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
    // Stopped once the newest day had enough matching lines.
    expect(bytes).toBeLessThanOrEqual(512 * 1024)

    // A filter that matches rarely reads further back, still within the budget.
    bytes = 0
    const errs = await readLogs([DIR], { level: 'error' }, red, d)
    expect(errs.lines).toEqual([])
    expect(bytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })

  it('drops a partial UTF-8 sequence and the partial first line at the tail cut', async () => {
    const big = `${'ệ'.repeat(400_000)}\n${line({ ts: '2026-01-01T00:00:00Z', msg: 'cuối' })}`
    const d = createDeps('fake', { files: { [join(DIR, 'x.log')]: big } })
    // The fake fs sizes files in characters; make stat report bytes so the cut lands mid-sequence.
    const stat = d.fs.stat.bind(d.fs)
    d.fs.stat = (async (p: string) => ({
      ...(await stat(p)),
      size: Buffer.byteLength(big),
    })) as typeof d.fs.stat
    const r = await readLogs([DIR], {}, red, d)
    expect(r.lines.map((l) => l.text)).toEqual(['cuối'])
  })
})

describe('launcher log pruning', () => {
  it('removes launcher-*.log files older than 14 days only', async () => {
    const d = createDeps('fake', {
      now: new Date('2026-02-20T12:00:00Z'),
      files: {
        [join(DIR, 'launcher-2026-01-01.log')]: 'x',
        [join(DIR, 'launcher-2026-02-05.log')]: 'x',
        [join(DIR, 'launcher-2026-02-06.log')]: 'x',
        [join(DIR, 'launcher-2026-02-20.log')]: 'x',
        [join(DIR, 'bridge-2026-01-01.log')]: 'x',
      },
    })
    expect(await pruneLauncherLogs(DIR, d)).toEqual(['launcher-2026-01-01.log', 'launcher-2026-02-05.log'])
    expect((await d.fs.readdir(DIR)).map(String).sort()).toEqual([
      'bridge-2026-01-01.log',
      'launcher-2026-02-06.log',
      'launcher-2026-02-20.log',
    ])
  })
})
