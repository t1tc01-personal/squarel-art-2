/**
 * Pixel banner of design.md: gradient sky, stars, moon, three sine-wave hill layers and a knight,
 * drawn as SVG rects on an 8px grid (generated at runtime, nothing loaded). A day version (sun,
 * clouds, green hills) sits in the same SVG; pages.css shows it for the light colour scheme.
 */
import type { ReactNode } from 'react'

const W = 110
const H = 38

const MOON = ['..####..', '.######.', '####....', '###.....', '###.....', '####....', '.######.', '..####..']
const KNIGHT = [
  '..####..',
  '.######.',
  '.#.##.#.',
  '.######.',
  '..####..',
  '.######.',
  '#.####.#',
  '..#..#..',
]

/** Deterministic pseudo-random stars. */
function stars(): { x: number; y: number; big: boolean }[] {
  const out: { x: number; y: number; big: boolean }[] = []
  let s = 7
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
  for (let i = 0; i < 46; i++)
    out.push({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * 20), big: rnd() > 0.8 })
  return out
}
const STARS = stars()

function hill(base: number, amp: number, period: number, phase: number): { x: number; top: number }[] {
  return Array.from({ length: W }, (_, x) => ({
    x,
    top: Math.round(base + amp * Math.sin((x / period) * Math.PI * 2 + phase)),
  }))
}
const HILL_SHAPES = [hill(19, 3, 46, 0.6), hill(25, 2, 30, 2.1), hill(30, 1.5, 22, 4)]
const NIGHT_HILLS = ['#1D2B53', '#3B2A5A', '#0F1A2E']
const DAY_HILLS = ['#9DB4E6', '#5DB462', '#2E8A4E']

const SUN = ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..']
const CLOUD = ['..###...', '.######.', '########']
const CLOUDS = [
  { x: 30, y: 6 },
  { x: 52, y: 3 },
  { x: 98, y: 15 },
]

function Hills({ colors }: { colors: readonly string[] }) {
  return HILL_SHAPES.map((cols, i) => (
    <g key={colors[i]} fill={colors[i]}>
      {cols.map((c) => (
        <rect key={c.x} x={c.x} y={c.top} width={1} height={H - c.top} />
      ))}
    </g>
  ))
}

/** Set pixels of a bitmap as {x, y}. */
function cells(rows: readonly string[]): { x: number; y: number }[] {
  return rows.flatMap((r, y) => [...r].flatMap((c, x) => (c === '#' ? [{ x, y }] : [])))
}

function Sprite({ rows, x, y, color }: { rows: readonly string[]; x: number; y: number; color: string }) {
  return (
    <g fill={color}>
      {cells(rows).map((p) => (
        <rect key={`${p.x}-${p.y}`} x={x + p.x} y={y + p.y} width={1} height={1} />
      ))}
    </g>
  )
}

export function Banner({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <section className={`banner${className ? ` ${className}` : ''}`}>
      <svg
        className="banner-art"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="banner-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1C2B54" />
            <stop offset="1" stopColor="#0D0F1C" />
          </linearGradient>
          <linearGradient id="banner-sky-day" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7CC4FB" />
            <stop offset="1" stopColor="#D3ECFF" />
          </linearGradient>
        </defs>
        <g className="banner-night">
          <rect width={W} height={H} fill="url(#banner-sky)" />
          {STARS.map((s) => (
            <rect
              key={`${s.x}-${s.y}`}
              x={s.x}
              y={s.y}
              width={s.big ? 1 : 0.5}
              height={s.big ? 1 : 0.5}
              fill="#FFF1E8"
              opacity={s.big ? 0.85 : 0.55}
            />
          ))}
          <Sprite rows={MOON} x={86} y={5} color="#FFEC27" />
          <Hills colors={NIGHT_HILLS} />
        </g>
        <g className="banner-day">
          <rect width={W} height={H} fill="url(#banner-sky-day)" />
          {CLOUDS.map((c) => (
            <Sprite key={`${c.x}-${c.y}`} rows={CLOUD} x={c.x} y={c.y} color="#FFFFFF" />
          ))}
          <Sprite rows={SUN} x={86} y={5} color="#FFA300" />
          <Sprite
            rows={['.####.', '######', '######', '######', '######', '.####.']}
            x={87}
            y={6}
            color="#FFEC27"
          />
          <Hills colors={DAY_HILLS} />
        </g>
        <Sprite rows={KNIGHT} x={76} y={22} color="#29ADFF" />
      </svg>
      <div className="banner-body">{children}</div>
    </section>
  )
}
