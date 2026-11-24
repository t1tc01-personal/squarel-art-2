/**
 * Real-Aseprite check (not run in CI): PixelDoc → .aseprite → PixelDoc must be identical.
 * Needs ASEPRITE_PATH in .env. Usage: pnpm aseprite:test
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asepriteAvailable, CLI_SCRIPTS, runAsepriteScript } from '../src/bridge/aseprite-cli.ts'
import { loadConfig } from '../src/config.ts'
import {
  addFrame,
  addLayer,
  celKey,
  createDoc,
  deserializeDoc,
  diff,
  ensureColor,
  serializeDoc,
} from '../src/core/index.ts'

const cfg = loadConfig()
if (!asepriteAvailable(cfg.asepritePath)) {
  console.log('SKIP: set ASEPRITE_PATH in .env to run the real Aseprite round-trip.')
  process.exit(0)
}
const doc = createDoc({ width: 24, height: 16, purpose: 'game', palette: 'pico8' })
const top = addLayer(doc, { name: 'Lớp 2' })
const f2 = addFrame(doc, { durationMs: 150 })
doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)].fill(3, 0, 40)
doc.cels[celKey(top.id, f2.id)][100] = ensureColor(doc, '#123456')
doc.layers[1].opacity = 120

const dir = mkdtempSync(join(tmpdir(), 'squarel-ase-'))
try {
  const inJson = join(dir, 'in.json')
  const ase = join(dir, 'work.aseprite')
  const outJson = join(dir, 'out.json')
  writeFileSync(
    inJson,
    JSON.stringify({ ref: 'roundtrip/roundtrip', baseVersion: 'v000001', doc: serializeDoc(doc) }),
  )
  await runAsepriteScript(cfg.asepritePath, CLI_SCRIPTS.docToAseprite, { in: inJson, out: ase })
  await runAsepriteScript(cfg.asepritePath, CLI_SCRIPTS.asepriteToDoc, { in: ase, out: outJson })
  const back = JSON.parse(readFileSync(outJson, 'utf8'))
  const p = diff(doc, deserializeDoc(back.doc))
  const ok =
    p.pixelCount === 0 && !p.addedLayers.length && !p.removedLayers.length && back.baseVersion === 'v000001'
  console.log(
    ok ? 'OK: Aseprite round-trip is lossless.' : `FAIL: ${JSON.stringify({ ...p, cels: p.cels.length })}`,
  )
  process.exit(ok ? 0 : 1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
