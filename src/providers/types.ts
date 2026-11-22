export type Quality = 'free' | 'high'
export type Task = 'generate' | 'edit' | 'animate'
export type UnitKind = 'neuron' | 'credit' | 'none'

export interface GenRequest {
  prompt: string
  /** Target doc size in pixels (providers render larger; normalize() brings it back). */
  width: number
  height: number
  /** Opaque hex colors the result should use (providers with paletteInput honour it). */
  palette?: string[]
  variants: number
  seed?: number
}

export interface EditRequest extends GenRequest {
  /** Current artwork, PNG, already upscaled for the provider. */
  image: Uint8Array
  /** Optional PNG mask (white = area to change). */
  mask?: Uint8Array
  /** 0..1 how far the result may move away from the input. */
  strength?: number
}

export interface AnimRequest extends GenRequest {
  action: string
  frames: number
  direction?: string
}

export interface RawImage {
  /** Encoded image (PNG/JPEG/WebP) as returned by the provider. */
  bytes: Uint8Array
  seed?: number
  /** For animations: frame count laid out horizontally in the sheet. */
  frames?: number
}

export interface Quote {
  usd: number
  units: number
  unitKind: UnitKind
  model: string
}

export interface Capabilities {
  generate: boolean
  edit: boolean
  inpaint: boolean
  animate: boolean
  nativePixel: boolean
  paletteInput: boolean
  paid: boolean
}

export interface ImageProvider {
  id: 'cloudflare' | 'retrodiffusion' | 'local-sd' | 'mock'
  capabilities: Capabilities
  configured(): boolean
  quote(task: Task, req: GenRequest): Promise<Quote>
  generate(req: GenRequest, signal?: AbortSignal): Promise<RawImage[]>
  edit?(req: EditRequest, signal?: AbortSignal): Promise<RawImage[]>
  animate?(req: AnimRequest, signal?: AbortSignal): Promise<RawImage[]>
  health(): Promise<boolean>
}

export class ProviderError extends Error {
  readonly status?: number
  readonly retryable: boolean
  constructor(message: string, o: { status?: number; retryable?: boolean } = {}) {
    super(message)
    this.status = o.status
    this.retryable = o.retryable ?? false
  }
}
