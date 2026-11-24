import type { PixelDocJSON, Source } from '../shared/types.ts'

/** Wire protocol version. Clients must send it in `hello`; older clients are refused. */
export const BRIDGE_PROTOCOL = 2

/** One art the bridge can serve, across every known project. */
export interface ArtEntry {
  /** `<project id>/<art id>` */
  ref: string
  /** Project id. */
  project: string
  /** Project display name. */
  projectName: string
  /** Art id inside the project. */
  art: string
  /** Art display name. */
  name: string
  /** Head version id. */
  head: string
}

/** One connected bridge client, as reported by `status`. */
export interface BridgeClientInfo {
  /** The `client` name sent in `hello` (e.g. "aseprite"). */
  name: string
  /** Version of the client's extension, from `hello.ext`. */
  ext?: string
  /** Version of the host tool (e.g. Aseprite "1.3.18.6"). */
  app?: string
  /** Art the client has open (`<project id>/<art id>`), if any. */
  ref?: string
  /** PixelDoc version id (e.g. "v000002") the client last received or committed for `ref`. NOT a tool version: that is `app`. */
  version?: string
  /** ISO time the client connected. */
  connectedAt: string
  /** ISO time of the client's last message. */
  lastSeen: string
}

/** Messages from the Aseprite extension (or any editor client) to the bridge. */
export type ClientMessage =
  | { type: 'hello'; client: string; ext?: string; app?: string; aseprite?: string; protocol?: number }
  | { type: 'list' }
  | { type: 'open'; ref: string }
  | { type: 'cels'; ref: string; baseVersion: string; doc: PixelDocJSON; label?: string }
  | { type: 'tool'; id: string; name: string; input?: unknown; ref?: string }
  | { type: 'ping' }
  | { type: 'status' }

/** Messages from the bridge to clients. */
export type ServerMessage =
  | {
      type: 'welcome'
      server: 'squarel-bridge'
      version: string
      protocol: typeof BRIDGE_PROTOCOL
      arts: ArtEntry[]
    }
  | { type: 'arts'; arts: ArtEntry[] }
  | { type: 'doc'; ref: string; versionId: string; doc: PixelDocJSON }
  | { type: 'ack'; ref: string; versionId: string }
  | { type: 'rebased'; ref: string; versionId: string; doc: PixelDocJSON; warnings: string[] }
  | { type: 'doc.updated'; ref: string; versionId: string; source: Source; label: string; doc: PixelDocJSON }
  | { type: 'open.request'; ref: string }
  | { type: 'tool_result'; id: string; ok: boolean; text: string; files?: string[] }
  | { type: 'pong' }
  | { type: 'status'; version: string; clients: BridgeClientInfo[] }
  | { type: 'error'; code: string; message: string }

/** Sent (then the socket is closed) to a client whose `hello` lacks `protocol: 2`. */
export const EXTENSION_OUTDATED_MESSAGE =
  'This Squarel bridge (0.4) needs the Squarel extension 0.4 or newer. Update it from Squarel Art Launcher: Aseprite → Cài extension.'

export const BRIDGE_PATH = '/bridge'
