export type Level = 'ok' | 'warn' | 'error' | 'running' | 'idle'
export interface ComponentView {
  id: string
  name: string
  description: string
  kind: 'core' | 'integration'
  /** Icon name from the design list ('name') or a `data:image/png;base64,…` URL ('data'). */
  icon: string
  iconKind: 'name' | 'data'
  accent?: string
  required: boolean
  installed: boolean
  version?: string
  latest?: string
  latestError?: string
  level: Level
  levelLabel: string
  incompatible?: string
  /** Non-fatal detail (e.g. why an icon fell back). */
  note?: string
  actions: ActionRef[]
}
export interface ActionRef {
  componentId: string
  kind: 'install' | 'update' | 'launch' | 'extension' | 'fix' | 'terminal'
  id: string
  label: string
  needsConsent?: { command: string; sizeHint?: string }
}
export interface CheckResult {
  id: string
  group: 'claude' | 'bridge' | 'ai' | 'machine' | string
  label: string
  description: string
  result: 'pass' | 'warn' | 'fail'
  detail: string
  fix?: ActionRef
}
export interface PresenceItem {
  id: string
  title: string
  subtitle: string
  status: 'online' | 'busy' | 'away' | 'offline'
  icon: string
  /** Defaults to 'name'. */
  iconKind?: 'name' | 'data'
}
export interface PresenceGroup {
  id: 'claude' | 'tools' | 'services'
  label: string
  items: PresenceItem[]
}
export interface TaskEvent {
  taskId: string
  kind: 'line' | 'progress' | 'done' | 'error'
  text?: string
  percent?: number
  code?: number
}
