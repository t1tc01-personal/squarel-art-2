declare module 'gifenc' {
  export interface GIFEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: number[][]; delay?: number; transparent?: boolean; transparentIndex?: number; repeat?: number },
    ): void
    finish(): void
    bytes(): Uint8Array
  }
  export function GIFEncoder(opts?: { auto?: boolean }): GIFEncoderInstance
  const gifenc: { GIFEncoder(opts?: { auto?: boolean }): GIFEncoderInstance }
  export default gifenc
}

declare module 'fengari' {
  export const lua: any
  export const lauxlib: any
  export const lualib: any
  export function to_luastring(s: string): Uint8Array
  export function to_jsstring(s: Uint8Array): string
}
