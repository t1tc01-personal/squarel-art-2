/**
 * The fixed list of IPC channels between renderer and main (spec §12), each with a zod schema for
 * its input and its output. Main validates both directions; anything not listed here is refused.
 * The preload imports only types from this file (no zod at runtime in the sandboxed preload).
 */
import { z } from 'zod'
import type { ActionRef, CheckResult, ComponentView, PresenceGroup, TaskEvent } from './model'

/** `.env` keys the renderer may read (masked) and write. */
export const ENV_KEYS = [
  'DATA_DIR',
  'IMAGE_PROVIDER',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'RETRO_DIFFUSION_API_KEY',
  'IMAGE_DAILY_BUDGET_USD',
  'LOCAL_SD_URL',
  'BRIDGE_PORT',
  'ASEPRITE_PATH',
] as const
export type EnvKey = (typeof ENV_KEYS)[number]
/** Never leave main unmasked. */
export const SECRET_ENV_KEYS: readonly EnvKey[] = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'RETRO_DIFFUSION_API_KEY',
]
export const IMAGE_PROVIDERS = ['cloudflare', 'local-sd', 'mock'] as const

const CONTROL = /[\r\n\0]/
const str = (max: number) => z.string().max(max)
/** Integration / component id (`^[a-z][a-z0-9-]{1,31}$` like manifests). */
const compId = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/)
const actionId = z.string().regex(/^[A-Za-z0-9][\w.-]{0,63}$/)
const level = z.enum(['ok', 'warn', 'error', 'running', 'idle'])
const setupStepSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal('done')])

export const actionRefSchema = z.strictObject({
  componentId: compId,
  kind: z.enum(['install', 'update', 'launch', 'extension', 'fix', 'terminal']),
  id: actionId,
  label: str(200),
  needsConsent: z.strictObject({ command: str(4000), sizeHint: str(100).optional() }).optional(),
  project: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .optional(),
  pickProject: z.boolean().optional(),
})

export const componentViewSchema = z.object({
  id: str(64),
  name: str(200),
  description: str(2000),
  kind: z.enum(['core', 'integration']),
  icon: str(100_000),
  iconKind: z.enum(['name', 'data']),
  accent: str(16).optional(),
  required: z.boolean(),
  installed: z.boolean(),
  version: str(100).optional(),
  latest: str(100).optional(),
  latestError: str(2000).optional(),
  level,
  levelLabel: str(500),
  incompatible: str(500).optional(),
  note: str(2000).optional(),
  actions: z.array(actionRefSchema),
})

export const checkResultSchema = z.object({
  id: str(200),
  group: str(100),
  label: str(500),
  description: str(2000),
  result: z.enum(['pass', 'warn', 'fail']),
  detail: str(4000),
  fix: actionRefSchema.optional(),
  builtin: str(40).optional(),
})

export const presenceGroupSchema = z.object({
  id: z.enum(['claude', 'tools', 'services']),
  label: str(100),
  items: z.array(
    z.object({
      id: str(300),
      title: str(300),
      subtitle: str(1000),
      status: z.enum(['online', 'busy', 'away', 'offline']),
      icon: str(100_000),
      iconKind: z.enum(['name', 'data']).optional(),
      componentId: str(64).optional(),
    }),
  ),
})

export const taskEventSchema = z.object({
  taskId: str(200),
  kind: z.enum(['line', 'progress', 'done', 'error']),
  text: str(20_000).optional(),
  percent: z.number().optional(),
  code: z.number().optional(),
})

/** Mirror of main/state.ts LauncherState (main checks both stay assignable to each other). */
export const launcherStateSchema = z.object({
  schema: z.literal(1),
  squarelDir: z.string().optional(),
  mode: z.enum(['fresh', 'clone']).optional(),
  setupStep: setupStepSchema,
  selected: z.array(z.string()),
  installChoice: z.record(z.string(), z.string()),
  closeToTray: z.boolean(),
  autostart: z.boolean(),
  lastUpdateCheck: z.string().optional(),
})
export type LauncherStateView = z.infer<typeof launcherStateSchema>

/** Fields the renderer may change; `schema` and `lastUpdateCheck` belong to main. */
export const statePatchSchema = z
  .strictObject({
    squarelDir: z
      .string()
      .min(1)
      .max(260)
      .refine((s) => !CONTROL.test(s)),
    mode: z.enum(['fresh', 'clone']),
    setupStep: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal('done')]),
    selected: z.array(compId).max(64),
    installChoice: z.record(compId, actionId),
    closeToTray: z.boolean(),
    autostart: z.boolean(),
  })
  .partial()
export type StatePatch = z.infer<typeof statePatchSchema>

export const envEntrySchema = z.object({ set: z.boolean(), value: str(4096), secret: z.boolean() })
export const envViewSchema = z.record(z.enum(ENV_KEYS), envEntrySchema)
export type EnvView = z.infer<typeof envViewSchema>

export const envSetSchema = z.strictObject({
  key: z.enum(ENV_KEYS),
  value: z
    .string()
    .max(4096)
    .refine((v) => !CONTROL.test(v), 'giá trị chứa ký tự xuống dòng hoặc NUL'),
})

export const latestSchema = z.union([
  z.object({ ok: z.literal(true), version: str(100) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['offline', 'rate-limited', 'not-found', 'error']),
    message: str(2000),
  }),
])

export const squarelPlanSchema = z.union([
  z.object({ kind: z.literal('tag'), from: str(100).optional(), to: str(100) }),
  z.object({ kind: z.literal('branch'), branch: str(300) }),
  z.object({
    kind: z.literal('blocked'),
    reason: z.enum(['dirty', 'not-a-repo', 'orphan-commits']),
    message: str(2000),
  }),
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('error'), message: str(2000) }),
])

export const updatesInfoSchema = z.object({
  checkedAt: str(40),
  launcher: latestSchema,
  squarel: squarelPlanSchema,
})
export type UpdatesInfo = z.infer<typeof updatesInfoSchema>

export const checksSnapshotSchema = z.object({ at: str(40), results: z.array(checkResultSchema) })
export type ChecksSnapshot = z.infer<typeof checksSnapshotSchema>

export const fileFilterSchema = z.strictObject({
  name: str(64).refine((s) => !CONTROL.test(s)),
  extensions: z
    .array(z.string().regex(/^(\*|[A-Za-z0-9]{1,10})$/))
    .min(1)
    .max(10),
})
export type FileFilter = z.infer<typeof fileFilterSchema>

export const recentProjectSchema = z.object({
  slug: str(64),
  name: str(300),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  version: str(40),
  updatedAt: str(40),
})
export type RecentProject = z.infer<typeof recentProjectSchema>

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]
const logSource = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)

export const logLineSchema = z.object({
  /** ISO time, '' when the line had none. */
  ts: str(40),
  level: z.enum(LOG_LEVELS),
  source: logSource,
  text: str(4000),
})
export type LogLine = z.infer<typeof logLineSchema>

export const logsQuerySchema = z.strictObject({
  source: logSource.optional(),
  /** Minimum level; 'info' also includes debug lines. */
  level: z.enum(['info', 'warn', 'error']).optional(),
})
export type LogsQuery = z.infer<typeof logsQuerySchema>

export const logsResultSchema = z.object({
  /** DATA_DIR\logs (display + "open folder"), null when unknown. */
  dir: str(1000).nullable(),
  /** Every source present before filtering. */
  sources: z.array(logSource).max(50),
  /** Last 500 matching lines, oldest first, already redacted. */
  lines: z.array(logLineSchema).max(500),
})
export type LogsResult = z.infer<typeof logsResultSchema>

export const aboutSchema = z.object({
  launcherVersion: str(100),
  squarelVersion: str(100).nullable(),
  repoUrl: str(300),
})
export type About = z.infer<typeof aboutSchema>

export const catalogEntrySchema = z.object({
  id: str(64),
  name: str(200),
  description: str(2000),
  icon: str(2),
  accent: str(16),
  status: z.literal('coming-soon'),
})
export type CatalogEntryView = z.infer<typeof catalogEntrySchema>

/** Checks the setup wizard runs one at a time. */
export const SETUP_CHECKS = [
  'cloudflare-token',
  'claude-installed',
  'claude-sees-squarel',
  'mcp-starts',
] as const
export type SetupCheckId = (typeof SETUP_CHECKS)[number]

/** One way to install an integration (manifest `install[]`), for the wizard's choice list. */
export const setupInstallOptionSchema = z.object({
  id: str(64),
  label: str(200),
  note: str(1000).optional(),
  /** Display form of the command (`run` options). */
  command: str(4000).optional(),
  /** File name to pick (`pickFile` options), stored in `setEnv`. */
  pickFile: str(200).optional(),
  setEnv: str(100).optional(),
})

export const setupInfoSchema = z.object({
  /** The step to show (saved step, corrected by what is installed); 'done' = no wizard. */
  step: setupStepSchema,
  winget: z.boolean(),
  launcherVersion: str(100),
  /** The default install folder (%LOCALAPPDATA%, SquarelArt, app), null when unknown. */
  defaultInstall: str(1000).nullable(),
  /** Display form of the clone command for "Cài mới", null when the version is not a release tag. */
  cloneCommand: str(2000).nullable(),
  depsInstalled: z.boolean(),
  /** Core components (detection only, no network). */
  tools: z.array(componentViewSchema),
  /** Missing base tools: each a terminal action (winget window, PowerShell, or download page). */
  plan: z.array(actionRefSchema),
  integrations: z.array(
    z.object({
      id: str(64),
      name: str(200),
      extension: z.boolean(),
      options: z.array(setupInstallOptionSchema),
    }),
  ),
  /** Fixed https link to the Aseprite EULA (self-build notice). */
  asepriteEula: str(300),
})
export type SetupInfo = z.infer<typeof setupInfoSchema>

const none = z.undefined()
const taskId = str(200)

export const CHANNELS = {
  'state:get': { input: none, output: launcherStateSchema },
  'state:set': { input: statePatchSchema, output: launcherStateSchema },
  'components:list': { input: none, output: z.array(componentViewSchema) },
  'checks:run': { input: none, output: z.array(checkResultSchema) },
  'checks:last': { input: none, output: checksSnapshotSchema.nullable() },
  'presence:get': { input: none, output: z.array(presenceGroupSchema) },
  'env:get': { input: none, output: envViewSchema },
  'env:set': { input: envSetSchema, output: envViewSchema },
  'action:run': { input: actionRefSchema, output: taskId },
  'updates:check': { input: none, output: updatesInfoSchema },
  'updates:apply': { input: none, output: taskId },
  'dialog:pickFolder': { input: none, output: z.string().nullable() },
  'dialog:pickFile': {
    input: z.strictObject({ filters: z.array(fileFilterSchema).max(10) }),
    output: z.string().nullable(),
  },
  'shell:reveal': { input: z.strictObject({ path: z.string().min(1).max(32_767) }), output: none },
  'projects:recent': { input: none, output: z.array(recentProjectSchema).max(3) },
  'logs:read': { input: logsQuerySchema, output: logsResultSchema },
  /** Main redacts the text again before it reaches the clipboard. */
  'clipboard:write': { input: z.strictObject({ text: z.string().max(1_000_000) }), output: none },
  /** Opens the bundled LICENSE.md (fixed path, never from the renderer). */
  'license:open': { input: none, output: none },
  'app:about': { input: none, output: aboutSchema },
  'catalog:list': { input: none, output: z.array(catalogEntrySchema).max(100) },
  /** `refresh` re-reads PATH first (after a tool was installed in another window). */
  'setup:info': { input: z.strictObject({ refresh: z.boolean() }), output: setupInfoSchema },
  'checks:runOne': { input: z.strictObject({ id: z.enum(SETUP_CHECKS) }), output: checkResultSchema },
  'window:minimize': { input: none, output: none },
  /** Hides the window when state.closeToTray, otherwise quits the app. */
  'window:close': { input: none, output: none },
} as const
export type Channel = keyof typeof CHANNELS
export type ChannelInput<C extends Channel> = z.infer<(typeof CHANNELS)[C]['input']>
export type ChannelOutput<C extends Channel> = z.infer<(typeof CHANNELS)[C]['output']>

/** Events main pushes to the renderer. `components:changed` is a signal: refetch `components:list`. */
export const EVENTS = {
  'presence:changed': z.array(presenceGroupSchema),
  'task:event': taskEventSchema,
  'components:changed': z.null(),
  'checks:changed': checksSnapshotSchema,
} as const
export type EventName = keyof typeof EVENTS
export type EventPayload<E extends EventName> = z.infer<(typeof EVENTS)[E]>

type Unsubscribe = () => void

/** `window.squarel`: exactly these functions, nothing else. */
export interface SquarelApi {
  getState(): Promise<LauncherStateView>
  setState(patch: StatePatch): Promise<LauncherStateView>
  listComponents(): Promise<ComponentView[]>
  runChecks(): Promise<CheckResult[]>
  lastChecks(): Promise<ChecksSnapshot | null>
  getPresence(): Promise<PresenceGroup[]>
  getEnv(): Promise<EnvView>
  setEnv(input: { key: EnvKey; value: string }): Promise<EnvView>
  runAction(ref: ActionRef): Promise<string>
  checkUpdates(): Promise<UpdatesInfo>
  applyUpdates(): Promise<string>
  pickFolder(): Promise<string | null>
  pickFile(input: { filters: FileFilter[] }): Promise<string | null>
  reveal(input: { path: string }): Promise<void>
  recentProjects(): Promise<RecentProject[]>
  readLogs(query: LogsQuery): Promise<LogsResult>
  writeClipboard(input: { text: string }): Promise<void>
  openLicense(): Promise<void>
  about(): Promise<About>
  catalog(): Promise<CatalogEntryView[]>
  setupInfo(input: { refresh: boolean }): Promise<SetupInfo>
  runCheck(input: { id: SetupCheckId }): Promise<CheckResult>
  minimizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  onPresenceChanged(cb: (groups: PresenceGroup[]) => void): Unsubscribe
  onTaskEvent(cb: (e: TaskEvent) => void): Unsubscribe
  onComponentsChanged(cb: () => void): Unsubscribe
  onChecksChanged(cb: (s: ChecksSnapshot) => void): Unsubscribe
}

// Compile-time: the schemas describe exactly the shared model types.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _sameTypes: [
  Same<z.infer<typeof actionRefSchema>, ActionRef>,
  Same<z.infer<typeof componentViewSchema>, ComponentView>,
  Same<z.infer<typeof checkResultSchema>, CheckResult>,
  Same<z.infer<typeof presenceGroupSchema>, PresenceGroup>,
  Same<z.infer<typeof taskEventSchema>, TaskEvent>,
] = [true, true, true, true, true]
void _sameTypes
