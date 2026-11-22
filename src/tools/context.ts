import { type Config, loadConfig } from '../config.ts'
import { createLogger, type Logger } from '../log.ts'
import { defaultProviders, type ProviderMap, ProviderRouter } from '../providers/router.ts'
import type { Source } from '../shared/types.ts'
import { Store } from '../store/store.ts'
import type { EditorHost, ToolContext } from './types.ts'

export interface CreateContextOptions {
  config?: Partial<Config>
  source?: Source
  providers?: ProviderMap
  log?: Logger
  editor?: EditorHost
  fetchImpl?: typeof fetch
  logName?: string
}

export async function createToolContext(o: CreateContextOptions = {}): Promise<ToolContext> {
  const config = loadConfig(o.config)
  const store = new Store(config.dataDir)
  await store.init()
  const router = new ProviderRouter(config, store, o.providers ?? defaultProviders(config, o.fetchImpl))
  return {
    store,
    router,
    config,
    log: o.log ?? createLogger(o.logName ?? 'squarel', config.dataDir),
    session: {},
    source: o.source ?? 'claude',
    editor: o.editor,
  }
}
