/**
 * Pixel icons drawn at runtime from the 8×8 bitmaps in docs/launcher/design.md (Ruling B2): one
 * SVG <rect> per run of set pixels, crisp edges, filled with currentColor.
 */
import type { CSSProperties } from 'react'

const BITMAPS = {
  home: '...##... ..####.. .######. ######## .##..##. .##..##. .##..##. .######.',
  box: '.######. #......# ######## #......# #..##..# #......# #......# ########',
  heart: '.##..##. ######## ######## ######## .######. ..####.. ...##... ........',
  gear: '...##... .#.##.#. ..####.. ####.### ###.#### ..####.. .#.##.#. ...##...',
  list: '........ ##.##### ........ ##.##### ........ ##.##### ........ ........',
  play: '.#...... .##..... .###.... .####... .####... .###.... .##..... .#......',
  check: '........ .......# ......## #....##. ##..##.. .####... ..##.... ........',
  cross: '........ .#....#. ..#..#.. ...##... ...##... ..#..#.. .#....#. ........',
  alert: '...##... ...##... ..####.. ..#..#.. .##..##. .######. ##.##.## ########',
  refresh: '..####.. .#....## #.....## #....... #......# .#....#. ..####.. ........',
  folder: '........ ###..... #..####. ######## #......# #......# ######## ........',
  plug: '.#..#... .#..#... ######.. ######.. .####... ..##.... ..##.... ..##....',
  grid: '###.###. ###.###. ###.###. ........ ###.###. ###.###. ###.###. ........',
  pencil: '.....##. ....#..# ...#..#. ..#..#.. .#..#... #..#.... ##.#.... ###.....',
  plus: '...##... ...##... ...##... ######## ######## ...##... ...##... ...##...',
  collapse: '#....... #..#.... #...#... #.#####. #...#... #..#.... #....... ........',
  chevron: '........ ........ #......# .#....#. ..#..#.. ...##... ........ ........',
  cloud: '........ ...###.. ..#...#. .#.....# #......# #......# .######. ........',
  chip: '.#.#.#.. ######## #......# #.####.# #.####.# #......# ######## .#.#.#..',
  bolt: '....##.. ...##... ..##.... .######. ....##.. ...##... ..##.... .##.....',
  link: '........ .###.... #...#... #..###.. .###..#. ...#...# ....###. ........',
  sparkle: '...#.... ...#.... .#####.. ...#.... ...#..#. ......#. ....#### ......#.',
} as const

export type IconName = keyof typeof BITMAPS
export const ICON_NAMES = Object.keys(BITMAPS) as IconName[]

export function isIconName(s: string): s is IconName {
  return Object.hasOwn(BITMAPS, s)
}

type Run = { x: number; y: number; w: number }

/** Horizontal runs of set pixels, so each row needs only a few rects. */
function runs(rows: readonly string[]): Run[] {
  const out: Run[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (row[x] !== '#') {
        x++
        continue
      }
      let w = 0
      while (row[x + w] === '#') w++
      out.push({ x, y, w })
      x += w
    }
  })
  return out
}

const cache = new Map<string, Run[]>()
function runsFor(name: IconName): Run[] {
  let r = cache.get(name)
  if (!r) {
    r = runs(BITMAPS[name].split(' '))
    cache.set(name, r)
  }
  return r
}

export function PixelGrid({
  rows,
  cell,
  className,
  style,
}: {
  rows: readonly string[]
  cell: number
  className?: string
  style?: CSSProperties
}) {
  const w = Math.max(...rows.map((r) => r.length))
  const h = rows.length
  return (
    <svg
      className={className}
      style={style}
      width={w * cell}
      height={h * cell}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {runs(rows).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill="currentColor" />
      ))}
    </svg>
  )
}

/** A design icon at 16px (×2) by default; `size` 20 for rail items and the launch button. */
export function Icon({
  name,
  size = 16,
  className,
  style,
}: {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {runsFor(name).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill="currentColor" />
      ))}
    </svg>
  )
}

/**
 * An icon from the model: a design icon name (`iconKind: 'name'`) or a PNG data URL from an
 * integration manifest (`iconKind: 'data'`). Unknown names fall back to `box`.
 */
export function ModelIcon({
  icon,
  iconKind = 'name',
  size = 16,
  className,
}: {
  icon: string
  iconKind?: 'name' | 'data'
  size?: number
  className?: string
}) {
  if (iconKind === 'data' && icon.startsWith('data:image/png;base64,'))
    return (
      <img
        className={className ? `icon icon-img ${className}` : 'icon icon-img'}
        src={icon}
        width={size}
        height={size}
        alt=""
        draggable={false}
      />
    )
  return <Icon name={isIconName(icon) ? icon : 'box'} size={size} className={className} />
}

/** The yellow pixel "S" (6×7 grid). `cell` 2 → 12×14 in the title bar, 3 → 18×21 in the rail. */
const LOGO = ['.####.', '#....#', '#.....', '.####.', '.....#', '#....#', '.####.'] as const
export function Logo({ cell = 3, className }: { cell?: number; className?: string }) {
  return <PixelGrid rows={LOGO} cell={cell} className={className ? `logo ${className}` : 'logo'} />
}
