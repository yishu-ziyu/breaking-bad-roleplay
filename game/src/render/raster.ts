/**
 * A tiny software rasterizer. Everything is drawn at the logical resolution
 * into one pixel buffer and scaled up by whole numbers in CSS, so every pixel
 * on screen is the same size (the Pilgrimage rule).
 */
export type RGB = [number, number, number]

export class Raster {
  readonly data: Uint8ClampedArray
  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8ClampedArray(w * h * 4)
  }

  /** Transparent ground, so the page shows through around the diorama. */
  clear() {
    this.data.fill(0)
  }

  px(x: number, y: number, c: RGB) {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 4
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = 255
  }

  /** Additive-ish light: mixes toward c by a. */
  glow(x: number, y: number, c: RGB, a: number) {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 4
    const d = this.data
    d[i] = d[i] + (c[0] - d[i]) * a
    d[i + 1] = d[i + 1] + (c[1] - d[i + 1]) * a
    d[i + 2] = d[i + 2] + (c[2] - d[i + 2]) * a
  }

  rect(x: number, y: number, w: number, h: number, c: RGB) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c)
  }

  /** Scanline fill of a convex polygon with integer pixel coverage (no anti-aliasing). */
  poly(pts: [number, number][], c: RGB) {
    let minY = Infinity, maxY = -Infinity
    for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
    minY = Math.max(0, Math.floor(minY)); maxY = Math.min(this.h - 1, Math.ceil(maxY))
    for (let y = minY; y <= maxY; y++) {
      const sy = y + 0.5
      let lo = Infinity, hi = -Infinity
      for (let k = 0; k < pts.length; k++) {
        const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % pts.length]
        if ((sy >= y0 && sy < y1) || (sy >= y1 && sy < y0)) {
          const x = x0 + ((sy - y0) / (y1 - y0)) * (x1 - x0)
          lo = Math.min(lo, x); hi = Math.max(hi, x)
        }
      }
      if (lo > hi) continue
      for (let x = Math.round(lo); x < Math.round(hi); x++) this.px(x, y, c)
    }
  }

  /** Night grade: tint every pixel toward a moonlit blue by t in [0,1]. */
  grade(t: number) {
    if (t <= 0) return
    const d = this.data
    const mr = 1 - 0.66 * t, mg = 1 - 0.58 * t, mb = 1 - 0.3 * t
    const lift = 10 * t
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i] * mr + lift * 0.4
      d[i + 1] = d[i + 1] * mg + lift * 0.6
      d[i + 2] = d[i + 2] * mb + lift * 1.6
    }
  }
}

export const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]
export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

/** Stable per-coordinate noise for dithering, so the map never shimmers. */
export function hash(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
