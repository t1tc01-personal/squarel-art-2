import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cmakeConfigureArgs,
  parseBuildArgs,
  parseSetOutput,
  pickLatestStableTag,
  skiaAsset,
  upsertEnv,
  VS_BUILD_TOOLS_WINGET,
  vsDevEnvCommand,
} from '../scripts/lib/aseprite-build.ts'
import { tempDir } from './helpers.ts'

describe('aseprite:build helpers', () => {
  it('picks the newest stable tag, ignoring betas and odd refs', () => {
    const ls = [
      'aaa\trefs/tags/v1.2.40',
      'bbb\trefs/tags/v1.3.9',
      'ccc\trefs/tags/v1.3.18.6',
      'ddd\trefs/tags/v1.3.18.10',
      'eee\trefs/tags/v1.3.19-beta1',
      'fff\trefs/tags/v1.4-rc1',
      'ggg\trefs/tags/v1.3.2',
      '',
    ].join('\r\n')
    expect(pickLatestStableTag(ls)).toBe('v1.3.18.10')
    expect(pickLatestStableTag('')).toBeUndefined()
  })

  it('builds the Skia download like Aseprite build.sh does', () => {
    const s = skiaAsset('m124-08a5439a6b\n', join('C:', 'deps'))
    expect(s.url).toBe(
      'https://github.com/aseprite/skia/releases/download/m124-08a5439a6b/Skia-Windows-Release-x64.zip',
    )
    expect(s.dir).toBe(join('C:', 'deps', 'skia-m124'))
    expect(s.lib).toBe(join('C:', 'deps', 'skia-m124', 'out', 'Release-x64', 'skia.lib'))
    const args = cmakeConfigureArgs({ src: 'S', build: 'B', skia: s })
    expect(args).toContain('-DLAF_BACKEND=skia')
    expect(args).toContain(`-DSKIA_LIBRARY=${s.lib}`)
    expect(args.slice(0, 6)).toEqual(['-S', 'S', '-B', 'B', '-G', 'Ninja'])
  })

  it('parses the VS developer environment printed by cmd `set`', () => {
    const env = parseSetOutput('=C:=C:\\x\r\nPath=C:\\vs\\bin;C:\\Windows\r\nINCLUDE=a=b\r\n\r\nnoequals\r\n')
    expect(env).toEqual({ Path: 'C:\\vs\\bin;C:\\Windows', INCLUDE: 'a=b' })
    expect(vsDevEnvCommand('C:\\VS')).toBe(
      `""${join('C:\\VS', 'Common7', 'Tools', 'VsDevCmd.bat')}" -arch=x64 -host_arch=x64 -no_logo && set"`,
    )
  })

  it.runIf(process.platform === 'win32')('loads a VsDevCmd.bat from a path with spaces through cmd', () => {
    const t = tempDir()
    try {
      const vs = join(t.dir, 'Microsoft Visual Studio', '2022', 'Build Tools')
      mkdirSync(join(vs, 'Common7', 'Tools'), { recursive: true })
      writeFileSync(
        join(vs, 'Common7', 'Tools', 'VsDevCmd.bat'),
        '@echo off\r\nset SQUAREL_FAKE_VS=ok %*\r\n',
      )
      const r = spawnSync('cmd.exe', ['/d', '/s', '/c', vsDevEnvCommand(vs)], {
        encoding: 'utf8',
        windowsVerbatimArguments: true,
      })
      expect(r.status).toBe(0)
      expect(parseSetOutput(r.stdout).SQUAREL_FAKE_VS).toBe('ok -arch=x64 -host_arch=x64 -no_logo')
    } finally {
      t.cleanup()
    }
  })

  it('updates or appends ASEPRITE_PATH without touching other lines', () => {
    const crlf = 'A=1\r\nASEPRITE_PATH=C:\\old.exe\r\n# ASEPRITE_PATH=commented\r\n'
    expect(upsertEnv(crlf, 'ASEPRITE_PATH', 'D:\\new\\aseprite.exe')).toBe(
      'A=1\r\nASEPRITE_PATH=D:\\new\\aseprite.exe\r\n# ASEPRITE_PATH=commented\r\n',
    )
    expect(upsertEnv('A=1', 'ASEPRITE_PATH', 'x')).toBe('A=1\nASEPRITE_PATH=x\n')
    expect(upsertEnv('', 'ASEPRITE_PATH', 'x')).toBe('ASEPRITE_PATH=x\n')
    // a path with $ must be written literally (no regex replacement patterns)
    expect(upsertEnv('ASEPRITE_PATH=a\n', 'ASEPRITE_PATH', 'C:\\$&\\a.exe')).toBe(
      'ASEPRITE_PATH=C:\\$&\\a.exe\n',
    )
  })

  it('parses options and rejects unknown ones', () => {
    expect(parseBuildArgs(['--ref', 'main', '--clean', '--no-env'])).toMatchObject({
      ref: 'main',
      clean: true,
      writeEnv: false,
    })
    expect(() => parseBuildArgs(['--src'])).toThrow(/needs a value/)
    expect(() => parseBuildArgs(['--fast'])).toThrow(/unknown option/)
  })

  it('installs only the components Aseprite needs', () => {
    const override = VS_BUILD_TOOLS_WINGET[VS_BUILD_TOOLS_WINGET.indexOf('--override') + 1]
    expect(override).toContain('Microsoft.VisualStudio.Workload.VCTools')
    expect(override).toContain('Microsoft.VisualStudio.Component.VC.CMake.Project')
    expect(VS_BUILD_TOOLS_WINGET).not.toContain('--accept-package-agreements') // the user accepts the licence
  })

  it('script --help runs without building anything', () => {
    const r = spawnSync(
      process.execPath,
      [join(import.meta.dirname, '..', 'scripts', 'aseprite-build.ts'), '--help'],
      {
        encoding: 'utf8',
      },
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('--install-deps')
  })
})
