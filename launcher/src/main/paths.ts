import { join } from 'node:path'

export interface AppPaths {
  stateFile: string
  userIntegrations: string
  defaultInstall: string
  toolsDir(id: string): string
}

/** Pure path computation from the given environment; never touches the filesystem. */
export function appPaths(env: NodeJS.ProcessEnv): AppPaths {
  const appData = env.APPDATA
  const localAppData = env.LOCALAPPDATA
  if (!appData) throw new Error('APPDATA is not set; cannot locate the launcher data folder')
  if (!localAppData) throw new Error('LOCALAPPDATA is not set; cannot locate the install folder')
  const roaming = join(appData, 'SquarelArt Launcher')
  const local = join(localAppData, 'SquarelArt')
  return {
    stateFile: join(roaming, 'state.json'),
    userIntegrations: join(roaming, 'integrations'),
    defaultInstall: join(local, 'app'),
    toolsDir: (id) => join(local, 'tools', id),
  }
}
