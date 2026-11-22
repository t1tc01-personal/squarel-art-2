export type Purpose = 'game' | 'print' | 'digital' | 'craft'
export const PURPOSES: Purpose[] = ['game', 'print', 'digital', 'craft']

export type Source = 'claude' | 'editor' | 'ai' | 'cli' | 'import'

export interface Layer {
  id: string
  name: string
  visible: boolean
  /** 0..255, like Aseprite */
  opacity: number
  locked: boolean
  origin?: 'user' | 'ai' | 'claude'
}

export interface Frame {
  id: string
  durationMs: number
}

export interface AnimTag {
  name: string
  from: number
  to: number
}

export interface DocMeta {
  purpose: Purpose
  title?: string
  tags?: AnimTag[]
  /** Upper bound on palette size the user wants to keep (default 256). */
  maxColors?: number
}

/** In-memory document. Cels hold palette indices (0 = transparent). */
export interface PixelDoc {
  v: 1
  width: number
  height: number
  /** "#rrggbbaa", palette[0] is always "#00000000" */
  palette: string[]
  /** bottom → top */
  layers: Layer[]
  frames: Frame[]
  /** key = `${layerId}:${frameId}` */
  cels: Record<string, Uint8Array>
  meta: DocMeta
}

/** Serialized document (cels = base64(RLE(indices))). */
export interface PixelDocJSON extends Omit<PixelDoc, 'cels'> {
  cels: Record<string, string>
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const MAX_SIDE = 256
export const MAX_COLORS = 256
export const TRANSPARENT = '#00000000'
