import type { PlaceId } from "../sim/types"

export const TILE_W = 16
export const TILE_H = 8
export const GRID = 22
export const VIEW_W = 360
export const VIEW_H = 212
const OX = VIEW_W / 2
const OY = 14

/** Grid → screen, at ground level. */
export function iso(gx: number, gy: number, z = 0): [number, number] {
  return [OX + (gx - gy) * (TILE_W / 2), OY + (gx + gy) * (TILE_H / 2) - z]
}

export type Ground = "desert" | "suburb" | "road" | "dirt" | "lot"

const roadTiles = new Set<string>()
const dirtTiles = new Set<string>()
const key = (x: number, y: number) => `${x},${y}`
function line(set: Set<string>, x0: number, y0: number, x1: number, y1: number) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) set.add(key(x, y))
}
// Albuquerque, roughly: Central Ave across town, a few side streets, one dirt track out to the mesa.
line(roadTiles, 0, 10, 21, 10)
line(roadTiles, 10, 3, 10, 21)
line(roadTiles, 4, 10, 4, 18)
line(roadTiles, 4, 17, 16, 17)
line(roadTiles, 16, 10, 16, 17)
line(dirtTiles, 10, 4, 19, 4)
line(dirtTiles, 19, 2, 19, 4)

export function ground(gx: number, gy: number): Ground {
  if (roadTiles.has(key(gx, gy))) return "road"
  if (dirtTiles.has(key(gx, gy))) return "dirt"
  if (gx >= 2 && gx <= 18 && gy >= 7 && gy <= 20) return "suburb"
  return "desert"
}

export interface Place {
  id: PlaceId
  name: string
  gx: number
  gy: number
  w: number
  d: number
  anchor: [number, number]
}

export const PLACES: Record<PlaceId, Place> = {
  home: { id: "home", name: "怀特家", gx: 5, gy: 11, w: 3, d: 2, anchor: [4, 12] },
  street: { id: "street", name: "杰西家", gx: 6, gy: 18, w: 2, d: 2, anchor: [6, 17] },
  dea: { id: "dea", name: "DEA 办公室", gx: 5, gy: 6, w: 3, d: 3, anchor: [6, 10] },
  saul: { id: "saul", name: "索尔的律所", gx: 11, gy: 6, w: 4, d: 2, anchor: [12, 10] },
  pollos: { id: "pollos", name: "炸鸡店", gx: 12, gy: 12, w: 3, d: 2, anchor: [13, 10] },
  carwash: { id: "carwash", name: "A1A 洗车店", gx: 17, gy: 12, w: 3, d: 3, anchor: [16, 13] },
  superlab: { id: "superlab", name: "工业洗衣房", gx: 11, gy: 15, w: 4, d: 1, anchor: [10, 15] },
  desert: { id: "desert", name: "房车", gx: 19, gy: 1, w: 1, d: 1, anchor: [19, 2] },
}

function drivable(x: number, y: number) {
  return roadTiles.has(key(x, y)) || dirtTiles.has(key(x, y))
}

/** Shortest road route between two places, as grid points. */
export function route(from: PlaceId, to: PlaceId): [number, number][] {
  const a = PLACES[from].anchor, b = PLACES[to].anchor
  const prev = new Map<string, string | null>([[key(...a), null]])
  const queue: [number, number][] = [a]
  while (queue.length) {
    const [x, y] = queue.shift()!
    if (x === b[0] && y === b[1]) break
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny)
      if (!drivable(nx, ny) || prev.has(k)) continue
      prev.set(k, key(x, y))
      queue.push([nx, ny])
    }
  }
  const path: [number, number][] = []
  let cur: string | null | undefined = key(...b)
  if (!prev.has(cur)) return [a, b]
  while (cur) {
    const [x, y] = cur.split(",").map(Number)
    path.unshift([x, y])
    cur = prev.get(cur)
  }
  return path
}

/** A patrol loop for the DEA cruiser once heat is up. */
export const PATROL: [number, number][] = [
  ...route("dea", "pollos"), ...route("pollos", "carwash").slice(1), ...route("carwash", "street").slice(1),
  ...route("street", "home").slice(1), ...route("home", "dea").slice(1),
]
