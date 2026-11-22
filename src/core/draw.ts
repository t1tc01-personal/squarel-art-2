/** Drawing primitives on a single cel (palette indices). All return the number of pixels changed. */
export interface Canvas {
  data: Uint8Array
  width: number
  height: number
}

export function setPixel(c: Canvas, x: number, y: number, v: number): number {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return 0
  const i = y * c.width + x
  if (c.data[i] === v) return 0
  c.data[i] = v
  return 1
}

export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = []
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  let x = x0
  let y = y0
  for (;;) {
    pts.push([x, y])
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
  return pts
}

export function line(c: Canvas, x0: number, y0: number, x1: number, y1: number, v: number): number {
  let n = 0
  for (const [x, y] of linePoints(x0, y0, x1, y1)) n += setPixel(c, x, y, v)
  return n
}

export function rect(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  v: number,
  fill: boolean,
): number {
  let n = 0
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      if (!fill && yy !== y && yy !== y + h - 1 && xx !== x && xx !== x + w - 1) continue
      n += setPixel(c, xx, yy, v)
    }
  return n
}

/** Ellipse inscribed in the box (x,y,w,h). */
export function ellipse(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  v: number,
  fill: boolean,
): number {
  if (w <= 0 || h <= 0) return 0
  const rx = w / 2
  const ry = h / 2
  const cx = x + rx
  const cy = y + ry
  const inside = (px: number, py: number) => {
    const dx = (px + 0.5 - cx) / rx
    const dy = (py + 0.5 - cy) / ry
    return dx * dx + dy * dy <= 1
  }
  let n = 0
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      if (!inside(xx, yy)) continue
      if (!fill) {
        const edge = !inside(xx - 1, yy) || !inside(xx + 1, yy) || !inside(xx, yy - 1) || !inside(xx, yy + 1)
        if (!edge) continue
      }
      n += setPixel(c, xx, yy, v)
    }
  return n
}

/** 4-connected flood fill (contiguous=true) or global replace of the clicked color. */
export function floodFill(c: Canvas, x: number, y: number, v: number, contiguous = true): number {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return 0
  const target = c.data[y * c.width + x]
  if (target === v) return 0
  let n = 0
  if (!contiguous) {
    for (let i = 0; i < c.data.length; i++)
      if (c.data[i] === target) {
        c.data[i] = v
        n++
      }
    return n
  }
  const stack = [y * c.width + x]
  while (stack.length) {
    const i = stack.pop()!
    if (c.data[i] !== target) continue
    c.data[i] = v
    n++
    const px = i % c.width
    const py = (i - px) / c.width
    if (px > 0) stack.push(i - 1)
    if (px < c.width - 1) stack.push(i + 1)
    if (py > 0) stack.push(i - c.width)
    if (py < c.height - 1) stack.push(i + c.width)
  }
  return n
}
