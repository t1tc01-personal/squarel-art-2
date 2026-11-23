/**
 * `window.squarel`: one function per IPC channel of shared/ipc.ts and one subscriber per push
 * event, nothing else. No ipcRenderer, no generic invoke. Main validates every call; this file
 * only imports types from shared/ipc.ts so zod stays out of the sandboxed preload.
 */
import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import type { Channel, EventName, SquarelApi } from '../shared/ipc'

const call = (channel: Channel, arg?: unknown) =>
  arg === undefined ? ipcRenderer.invoke(channel) : ipcRenderer.invoke(channel, arg)

function subscribe(event: EventName, cb: (payload: never) => void): () => void {
  if (typeof cb !== 'function') throw new TypeError('callback required')
  const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload as never)
  ipcRenderer.on(event, listener)
  return () => void ipcRenderer.removeListener(event, listener)
}

const api: SquarelApi = {
  getState: () => call('state:get'),
  setState: (patch) => call('state:set', patch),
  listComponents: () => call('components:list'),
  runChecks: () => call('checks:run'),
  lastChecks: () => call('checks:last'),
  getPresence: () => call('presence:get'),
  getEnv: () => call('env:get'),
  setEnv: (input) => call('env:set', input),
  runAction: (ref) => call('action:run', ref),
  cancelTask: (input) => call('action:cancel', input),
  checkUpdates: () => call('updates:check'),
  applyUpdates: () => call('updates:apply'),
  pickFolder: () => call('dialog:pickFolder'),
  pickFile: (input) => call('dialog:pickFile', input),
  reveal: (input) => call('shell:reveal', input),
  recentProjects: () => call('projects:recent'),
  readLogs: (query) => call('logs:read', query),
  writeClipboard: (input) => call('clipboard:write', input),
  openLicense: () => call('license:open'),
  about: () => call('app:about'),
  catalog: () => call('catalog:list'),
  setupInfo: (input) => call('setup:info', input),
  runCheck: (input) => call('checks:runOne', input),
  minimizeWindow: () => call('window:minimize'),
  closeWindow: () => call('window:close'),
  onPresenceChanged: (cb) => subscribe('presence:changed', cb),
  onTaskEvent: (cb) => subscribe('task:event', cb),
  onComponentsChanged: (cb) => subscribe('components:changed', () => cb()),
  onChecksChanged: (cb) => subscribe('checks:changed', cb),
}

contextBridge.exposeInMainWorld('squarel', Object.freeze(api))
