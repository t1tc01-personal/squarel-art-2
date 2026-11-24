/** Bridge state shared by the checks, the presence panel and the supervisor (Task 7 imports from here). */
export type BridgeMode = 'own' | 'attached' | 'foreign' | 'down'

/** One connected bridge client, copied structurally from Squarel's bridge protocol. */
export interface BridgeClientInfo {
  name: string
  ext?: string
  app?: string
  ref?: string
  version?: string
  connectedAt: string
  lastSeen: string
}

export interface BridgeState {
  mode: BridgeMode
  port: number
  clients: BridgeClientInfo[]
  since: string
  message?: string
}
