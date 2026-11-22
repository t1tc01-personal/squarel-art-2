import type { PixelDocJSON, Source } from '../shared/types.ts'

/** Messages from the Aseprite extension (or any editor client) to the bridge. */
export type ClientMessage =
  | { type: 'hello'; client: string; ext?: string; aseprite?: string }
  | { type: 'list' }
  | { type: 'open'; slug: string }
  | { type: 'cels'; slug: string; baseVersion: string; doc: PixelDocJSON; label?: string }
  | { type: 'tool'; id: string; name: string; input?: unknown; slug?: string }
  | { type: 'ping' }

/** Messages from the bridge to clients. */
export type ServerMessage =
  | {
      type: 'welcome'
      server: 'squarel-bridge'
      version: string
      projects: { slug: string; name: string; head: string }[]
    }
  | { type: 'projects'; projects: { slug: string; name: string; head: string }[] }
  | { type: 'doc'; slug: string; versionId: string; doc: PixelDocJSON }
  | { type: 'ack'; slug: string; versionId: string }
  | { type: 'rebased'; slug: string; versionId: string; doc: PixelDocJSON; warnings: string[] }
  | { type: 'doc.updated'; slug: string; versionId: string; source: Source; label: string; doc: PixelDocJSON }
  | { type: 'open.request'; slug: string }
  | { type: 'tool_result'; id: string; ok: boolean; text: string; files?: string[] }
  | { type: 'pong' }
  | { type: 'error'; code: string; message: string }

export const BRIDGE_PATH = '/bridge'
