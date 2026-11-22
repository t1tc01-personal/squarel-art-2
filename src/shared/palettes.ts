/** Palette presets (opaque colors only; index 0 transparent is added by the doc). */
export const PALETTES: Record<string, { label: string; colors: string[] }> = {
  pico8: {
    label: 'PICO-8 (16)',
    colors: [
      '#000000',
      '#1d2b53',
      '#7e2553',
      '#008751',
      '#ab5236',
      '#5f574f',
      '#c2c3c7',
      '#fff1e8',
      '#ff004d',
      '#ffa300',
      '#ffec27',
      '#00e436',
      '#29adff',
      '#83769c',
      '#ff77a8',
      '#ffccaa',
    ],
  },
  sweetie16: {
    label: 'Sweetie 16',
    colors: [
      '#1a1c2c',
      '#5d275d',
      '#b13e53',
      '#ef7d57',
      '#ffcd75',
      '#a7f070',
      '#38b764',
      '#257179',
      '#29366f',
      '#3b5dc9',
      '#41a6f6',
      '#73eff7',
      '#f4f4f4',
      '#94b0c2',
      '#566c86',
      '#333c57',
    ],
  },
  db16: {
    label: 'DawnBringer 16',
    colors: [
      '#140c1c',
      '#442434',
      '#30346d',
      '#4e4a4e',
      '#854c30',
      '#346524',
      '#d04648',
      '#757161',
      '#597dce',
      '#d27d2c',
      '#8595a1',
      '#6daa2c',
      '#d2aa99',
      '#6dc2ca',
      '#dad45e',
      '#deeed6',
    ],
  },
  gameboy: {
    label: 'Game Boy (4)',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  },
  grayscale4: {
    label: 'Grayscale (4)',
    colors: ['#000000', '#555555', '#aaaaaa', '#ffffff'],
  },
  bw: {
    label: 'Black & white',
    colors: ['#000000', '#ffffff'],
  },
}

export function paletteColors(name: string): string[] | undefined {
  return PALETTES[name.toLowerCase()]?.colors
}
