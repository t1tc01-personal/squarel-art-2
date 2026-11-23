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
  /**
   * Launch actions with `pickProject` only: the project slug the user chose. Main checks it is an
   * existing project of DATA_DIR; it is never a path.
   */
  project?: string
  /** Launch actions: the renderer asks the user for a project first (manifest `pickProject`). */
  pickProject?: boolean
}
export interface CheckResult {
  id: string
  group: 'claude' | 'bridge' | 'ai' | 'machine' | string
  label: string
  description: string
  result: 'pass' | 'warn' | 'fail'
  detail: string
  fix?: ActionRef
  /** Integration checks only: the manifest's `builtin` kind (e.g. 'extension-version'). */
  builtin?: string
}
export interface PresenceItem {
  id: string
  title: string
  subtitle: string
  status: 'online' | 'busy' | 'away' | 'offline'
  icon: string
  /** Defaults to 'name'. */
  iconKind?: 'name' | 'data'
  /** The component (integration id) this row belongs to, e.g. a bridge tool's integration. */
  componentId?: string
}
export interface PresenceGroup {
  id: 'claude' | 'tools' | 'services'
  label: string
  items: PresenceItem[]
}
/** Where a multi-step task is (e.g. the Aseprite build): step 1-based, its label as printed. */
export interface TaskStep {
  step: number
  total: number
  label: string
  /** Counter inside the step, e.g. "812/1430" compiled files. */
  detail?: string
  /** Labels of all steps, when the tool announces them. */
  plan?: string[]
}
export interface TaskEvent {
  taskId: string
  kind: 'line' | 'progress' | 'done' | 'error'
  text?: string
  /** Overall percent of the whole task (0-100); never lower than an earlier event of the task. */
  percent?: number
  code?: number
  step?: TaskStep
}
