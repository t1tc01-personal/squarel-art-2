import type { PixelDocJSON, Source } from '../shared/types.ts'

/** One connected bridge client, as reported by `status`. */
export interface BridgeClientInfo {
  /** The `client` name sent in `hello` (e.g. "aseprite"). */
  name: string
  /** Version of the client's extension, from `hello.ext`. */
  ext?: string
  /** Version of the host tool (e.g. Aseprite "1.3.18.6"). */
  app?: string
  /** Project the client has open, if any. */
  slug?: string
  /** PixelDoc version id (e.g. "v000002") the client last received or committed for `slug`. NOT a tool version: that is `app`. */
  version?: string
  /** ISO time the client connected. */
  connectedAt: string
  /** ISO time of the client's last message. */
  lastSeen: string
}

/** Messages from the Aseprite extension (or any editor client) to the bridge. */
export type ClientMessage =
  | { type: 'hello'; client: string; ext?: string; app?: string; aseprite?: string }
  | { type: 'list' }
  | { type: 'open'; slug: string }
  | { type: 'cels'; slug: string; baseVersion: string; doc: PixelDocJSON; label?: string }
  | { type: 'tool'; id: string; name: string; input?: unknown; slug?: string }
  | { type: 'ping' }
  | { type: 'status' }

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
  | { type: 'status'; version: string; clients: BridgeClientInfo[] }
  | { type: 'error'; code: string; message: string }

export const BRIDGE_PATH = '/bridge'
