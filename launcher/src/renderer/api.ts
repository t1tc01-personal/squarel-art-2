/** Typed access to the preload bridge (`window.squarel`); see shared/ipc.ts for the channels. */
import type { SquarelApi } from '../shared/ipc'

declare global {
  interface Window {
    readonly squarel: SquarelApi
  }
}

export type {
  About,
  CatalogEntryView,
  ChecksSnapshot,
  EnvKey,
  EnvView,
  FileFilter,
  LogLine,
  LogsQuery,
  LogsResult,
  RecentArt,
  SquarelApi,
  StatePatch,
  UpdatesInfo,
} from '../shared/ipc'

export const api: SquarelApi = window.squarel
