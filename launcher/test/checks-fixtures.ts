import type { IntegrationManifestT } from '@squarel/integration-schema'
import type { Registry } from '../src/main/registry/registry'

function manifest(over: Partial<IntegrationManifestT>): IntegrationManifestT {
  return {
    schema: 1,
    id: 'demo',
    name: 'Demo',
    description: 'd',
    icon: 'icon.png',
    accent: '#112233',
    platforms: ['win32'],
    detect: { candidates: ['C:\\nope\\demo.exe'] },
    install: [],
    launch: [{ id: 'open', label: 'Open', default: true, run: ['{exe}'] }],
    checks: [],
    ...over,
  }
}

const reg = (m: IntegrationManifestT): Registry => ({
  core: [],
  integrations: [{ manifest: m, dir: 'D:/sq/integrations/demo', source: 'squarel' }],
  comingSoon: [],
  problems: [],
})

export const regWithManual = () =>
  reg(
    manifest({
      checks: [
        { id: 'auto', label: 'Auto', run: ['echo', 'auto'] },
        { id: 'slow', label: 'Slow', run: ['echo', 'slow'], manual: true },
      ],
    }),
  )

export const regWithBuiltins = () =>
  reg(
    manifest({
      bridge: { client: 'demo' },
      extension: {
        version: { source: 'integrations/demo/ext/package.json', installed: '%APPDATA%\\Demo\\package.json' },
        install: { run: ['echo'] },
      },
      checks: [
        { id: 'connected', label: 'Connected', builtin: 'bridge-client' },
        { id: 'extension', label: 'Extension', builtin: 'extension-version' },
      ],
    }),
  )
