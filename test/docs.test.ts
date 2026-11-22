import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToolsDoc } from '../scripts/gen-tools-doc.ts'

describe('docs', () => {
  it('docs/tools.md is up to date (run pnpm docs:tools)', () => {
    const file = readFileSync(join(import.meta.dirname, '..', 'docs', 'tools.md'), 'utf8')
    expect(file.replace(/\r\n/g, '\n')).toBe(renderToolsDoc())
  })
})
