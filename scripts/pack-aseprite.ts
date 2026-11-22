/**
 * Zip integrations/aseprite/squarel into squarel.aseprite-extension (double-click to install in Aseprite).
 *   pnpm aseprite:pack                 build the .aseprite-extension file
 *   pnpm aseprite:pack -- --install    also copy the files straight into Aseprite's extensions folder
 *                                      (%APPDATA%\Aseprite\extensions\squarel), keeping the extension's settings.
 *                                      Restart Aseprite afterwards: extensions load at startup.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { REPO_ROOT } from '../src/config.ts'

const dir = join(REPO_ROOT, 'integrations', 'aseprite', 'squarel')
const names = readdirSync(dir).filter((f) => /\.(lua|json)$/.test(f))
const files: Record<string, Uint8Array> = {}
for (const f of names) files[f] = new Uint8Array(readFileSync(join(dir, f)))
const out = join(REPO_ROOT, 'squarel.aseprite-extension')
writeFileSync(out, zipSync(files, { level: 9 }))
console.log(`Wrote ${out} (${names.join(', ')})`)

if (process.argv.includes('--install')) {
  const userDir =
    process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Aseprite')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support', 'Aseprite')
        : join(homedir(), '.config', 'aseprite')
  const target = join(userDir, 'extensions', 'squarel')
  mkdirSync(target, { recursive: true })
  for (const f of names) copyFileSync(join(dir, f), join(target, f))
  // Aseprite keeps this list to uninstall the extension later; __pref.lua (settings) is left untouched.
  writeFileSync(join(target, '__info.json'), JSON.stringify({ installedFiles: names }))
  console.log(`Installed into ${target}${existsSync(join(target, '__pref.lua')) ? ' (settings kept)' : ''}.`)
  console.log('Restart Aseprite to load the new version.')
} else {
  console.log(
    'Install: double-click the file, or Aseprite > Edit > Preferences > Extensions > Add Extension.',
  )
  console.log('Updating an installed copy: pnpm aseprite:pack -- --install, then restart Aseprite.')
}
