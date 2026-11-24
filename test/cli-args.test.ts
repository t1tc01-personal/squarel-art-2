import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/cli/args.ts'
import { ALL_TOOLS } from '../src/tools/registry.ts'

const input = (name: string) => ALL_TOOLS.find((t) => t.name === name)!.input

describe('CLI flag parsing', () => {
  it('keeps string params as text even when they look like JSON', () => {
    for (const slug of ['2048', '1', '1e3', 'true', 'null'])
      expect(parseArgs(['--slug', slug], input('art_import'))).toEqual({ slug })
    expect(parseArgs(['--art', '2048'], input('art_open'))).toEqual({ art: '2048' })
  })

  it('still parses numbers, booleans and JSON for other params', () => {
    expect(parseArgs(['--width', '32', '--legacy'], input('art_create'))).toMatchObject({
      width: 32,
      legacy: true,
    })
    expect(parseArgs(['--legacy', 'true'], input('art_list'))).toEqual({ legacy: true })
  })
})
