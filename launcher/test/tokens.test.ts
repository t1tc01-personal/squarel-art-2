import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(import.meta.dirname, '../src/renderer/tokens.css'), 'utf8')

describe('tokens.css', () => {
  it.each([
    ['--bg-app', '#0d0e12'],
    ['--bg-surface', '#171a21'],
    ['--text-primary', '#eceef3'],
    ['--accent-primary', '#29adff'],
    ['--accent-brand', '#ffec27'],
    ['--status-ok', '#00e436'],
    ['--space-32', '32px'],
    ['--radius-lg', '14px'],
  ])('defines %s as %s', (name, value) => {
    expect(css).toContain(`${name}: ${value};`)
  })

  it('has a light palette (Figma "Launcher tokens" · Light) behind prefers-color-scheme: light', () => {
    const at = css.indexOf('@media (prefers-color-scheme: light)')
    expect(at).toBeGreaterThan(0)
    const light = css.slice(at)
    for (const [name, value] of [
      ['--bg-app', '#f3f4f8'],
      ['--bg-surface', '#ffffff'],
      ['--text-primary', '#14161c'],
      ['--accent-primary', '#0b72c4'],
      ['--accent-brand', '#d89c00'],
      ['--status-ok', '#067a2e'],
    ])
      expect(light).toContain(`${name}: ${value};`)
  })
})
