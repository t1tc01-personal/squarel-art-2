import { join } from 'node:path'
import { type Config, loadConfig } from '../config.ts'
import { createLogger, type Logger } from '../log.ts'
import { defaultProviders, type ProviderMap, ProviderRouter } from '../providers/router.ts'
import type { Source } from '../shared/types.ts'
import { Store } from '../store/store.ts'
import { UsageLog } from '../store/usage.ts'
import { artsDirOf, detectWorkspace, duplicateProjectFolder } from '../store/workspace.ts'
import type { EditorHost, ToolContext } from './types.ts'

export interface CreateContextOptions {
  config?: Partial<Config>
  source?: Source
  providers?: ProviderMap
  log?: Logger
  editor?: EditorHost
  fetchImpl?: typeof fetch
  logName?: string
  /** Folder to detect the project from (walks up). Without it the context has no project. */
  projectStart?: string
  /** Makes the project's art store reject writes with this message. */
  readOnly?: string
}

export const LEGACY_READ_ONLY = 'Legacy art is read-only: move it into a project with art_import first.'

export async function createToolContext(o: CreateContextOptions = {}): Promise<ToolContext> {
  const config = loadConfig(o.config)
  const log = o.log ?? createLogger(o.logName ?? 'squarel', config.dataDir)
  const usage = new UsageLog(config.dataDir)
  const legacy = new Store(join(config.dataDir, 'projects'), { log, readOnly: LEGACY_READ_ONLY })
  const workspace = o.projectStart
    ? await detectWorkspace({ start: o.projectStart, dataDir: config.dataDir, log })
    : undefined
  const duplicateOf = workspace ? await duplicateProjectFolder(config.dataDir, workspace) : undefined
  const readOnly = duplicateOf
    ? `Project id "${workspace?.id}" is also used by ${duplicateOf}. Change the id in .squarel/project.json (or in Squarel Art Launcher → project → Cài đặt) to keep drawing here.`
    : o.readOnly
  const arts = workspace ? new Store(artsDirOf(workspace), { log, project: workspace, readOnly }) : undefined
  const router = new ProviderRouter(config, usage, o.providers ?? defaultProviders(config, o.fetchImpl))
  return {
    arts,
    legacy,
    usage,
    router,
    config,
    log,
    session: { workspace, duplicateOf },
    source: o.source ?? 'claude',
    editor: o.editor,
  }
}
