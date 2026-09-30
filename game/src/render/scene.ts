import { hash, hex, Raster, shade, type RGB } from "./raster"
import { GRID, ground, iso, PATROL, PLACES, TILE_H, TILE_W } from "./world"

export interface SceneView {
  /** 0 = noon, 1 = deep night. */
  night: number
  ownsCarwash: boolean
  superlab: boolean
  cookedThisWeek: boolean
  heat: number
  hankVisiting: boolean
  skylerWaiting: boolean
  car: { x: number; y: number }
  timeMs: number
  motion: boolean
}

const C = {
  earthL: hex("#6b4a33"),
  earthR: hex("#4f3726"),
  earthBand: hex("#80593c"),
  desert: hex("#d7b27a"),
  desertAlt: hex("#cda46c"),
  desertSpeck: hex("#b98f5c"),
  suburb: hex("#c9b07c"),
  suburbAlt: hex("#b9a56d"),
  lawn: hex("#8e9a5a"),
  road: hex("#5a5550"),
  roadAlt: hex("#646059"),
  roadLine: hex("#c9b27a"),
  dirt: hex("#b58c5d"),
  mesaTop: hex("#b27a52"),
  mesaL: hex("#8f5a3b"),
  mesaR: hex("#6f432b"),
  cactus: hex("#5d7a45"),
  cactusDark: hex("#44602f"),
  rock: hex("#8b7a66"),
  juniper: hex("#4d5e37"),
  juniperDark: hex("#3a4829"),
  win: hex("#3b4a55"),
  winLit: hex("#ffd28a"),
  blueGlow: hex("#7fe3f5"),
  lamp: hex("#ffc873"),
  pool: hex("#4fb3cf"),
  poolLight: hex("#9ee4f0"),
  shadow: hex("#000000"),
}

interface Light { x: number; y: number; c: RGB; r: number; a: number }

function rhombus(r: Raster, gx: number, gy: number, c: RGB, z = 0) {
  const [x, y] = iso(gx, gy, z)
  r.poly([[x, y], [x + TILE_W / 2, y + TILE_H / 2], [x, y + TILE_H], [x - TILE_W / 2, y + TILE_H / 2]], c)
}

function box(r: Raster, gx: number, gy: number, w: number, d: number, h: number, top: RGB, left: RGB, right: RGB) {
  const N = iso(gx, gy), E = iso(gx + w, gy), S = iso(gx + w, gy + d), W = iso(gx, gy + d)
  const up = (p: [number, number]): [number, number] => [p[0], p[1] - h]
  r.poly([W, S, up(S), up(W)], left)
  r.poly([S, E, up(E), up(S)], right)
  r.poly([up(N), up(E), up(S), up(W)], top)
}

/** Points along the left (W→S) or right (S→E) face of a box, for windows and trim. */
function facePoint(gx: number, gy: number, w: number, d: number, face: "L" | "R", t: number, z: number): [number, number] {
  if (face === "L") {
    const [x0, y0] = iso(gx, gy + d), [x1, y1] = iso(gx + w, gy + d)
    return [Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t - z)]
  }
  const [x0, y0] = iso(gx + w, gy + d), [x1, y1] = iso(gx + w, gy)
  return [Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t - z)]
}

function windows(r: Raster, lights: Light[], b: { gx: number; gy: number; w: number; d: number }, face: "L" | "R", count: number, z: number, lit: boolean, litColor = C.winLit) {
  for (let i = 0; i < count; i++) {
    const [x, y] = facePoint(b.gx, b.gy, b.w, b.d, face, (i + 0.5) / count, z)
    r.rect(x - 1, y - 1, 2, 2, C.win)
    if (lit) lights.push({ x, y, c: litColor, r: 3, a: 0.9 })
  }
}

function ground3(r: Raster) {
  r.clear()
  // the slab's earthen sides
  const depth = 12
  const L0 = iso(0, GRID), B0 = iso(GRID, GRID), R0 = iso(GRID, 0)
  r.poly([L0, B0, [B0[0], B0[1] + depth], [L0[0], L0[1] + depth]], C.earthL)
  r.poly([B0, R0, [R0[0], R0[1] + depth], [B0[0], B0[1] + depth]], C.earthR)
  for (let x = L0[0]; x <= R0[0]; x++) {
    const t = x <= B0[0] ? (x - L0[0]) / (B0[0] - L0[0]) : (R0[0] - x) / (R0[0] - B0[0])
    const yEdge = (x <= B0[0] ? L0[1] : R0[1]) + t * (B0[1] - (x <= B0[0] ? L0[1] : R0[1]))
    if (hash(x, 3) < 0.7) r.px(x, Math.round(yEdge + 5), C.earthBand)
  }

  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    const g = ground(gx, gy)
    const n = hash(gx, gy)
    const base =
      g === "road" ? (n < 0.5 ? C.road : C.roadAlt)
      : g === "dirt" ? C.dirt
      : g === "suburb" ? (n < 0.18 ? C.lawn : n < 0.6 ? C.suburb : C.suburbAlt)
      : n < 0.5 ? C.desert : C.desertAlt
    rhombus(r, gx, gy, base)
    const [x, y] = iso(gx, gy)
    for (let k = 0; k < 4; k++) {
      const sx = x - 6 + Math.floor(hash(gx, gy, k) * 12), sy = y + 2 + Math.floor(hash(gy, gx, k + 9) * 4)
      if (g === "desert" || g === "dirt") r.px(sx, sy, C.desertSpeck)
    }
    if (g === "road" && ground(gx + 1, gy) === "road" && ground(gx - 1, gy) === "road" && gx % 2 === 0) r.px(x, y + 4, C.roadLine)
    if (g === "road" && ground(gx, gy + 1) === "road" && ground(gx, gy - 1) === "road" && gy % 2 === 0) r.px(x, y + 4, C.roadLine)
  }
}

type Drawable = { depth: number; draw: () => void }

export function renderScene(r: Raster, v: SceneView): void {
  ground3(r)
  const lights: Light[] = []
  const items: Drawable[] = []
  const lit = v.night > 0.5
  const add = (depth: number, draw: () => void) => items.push({ depth, draw })

  // Sandia foothills and mesas along the north edge
  for (const [gx, gy, w, d, h] of [[0, 0, 5, 2, 18], [5, 0, 3, 1, 11], [0, 2, 2, 2, 9], [14, 0, 3, 1, 8], [1, 6, 1, 1, 5]] as const) {
    add(gx + gy + w + d, () => {
      box(r, gx, gy, w, d, h, C.mesaTop, C.mesaL, C.mesaR)
      for (let i = 0; i < 6; i++) {
        const [x, y] = facePoint(gx, gy, w, d, "L", hash(gx, i) , 2 + hash(i, gy) * (h - 4))
        r.px(x, y, shade(C.mesaL, 1.15))
      }
    })
  }

  // desert scatter: saguaros and rocks, placed by hash so the map is the same every visit
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    if (ground(gx, gy) !== "desert") continue
    const n = hash(gx, gy, 7)
    const [x, y] = iso(gx + 0.5, gy + 0.5)
    if (n < 0.07) add(gx + gy + 1, () => {
      r.rect(x, y - 7, 1, 7, C.cactus); r.rect(x + 1, y - 7, 1, 7, C.cactusDark)
      r.rect(x - 2, y - 5, 1, 3, C.cactus); r.rect(x - 1, y - 3, 1, 1, C.cactus)
      r.rect(x + 3, y - 6, 1, 3, C.cactusDark); r.rect(x + 2, y - 4, 1, 1, C.cactusDark)
    })
    else if (n < 0.13) add(gx + gy + 1, () => { r.rect(x - 1, y - 1, 3, 2, C.rock); r.px(x - 1, y - 1, shade(C.rock, 1.2)) })
  }
  for (let gy = 7; gy < 21; gy++) for (let gx = 2; gx < 19; gx++) {
    if (ground(gx, gy) !== "suburb") continue
    if (Object.values(PLACES).some(p => gx >= p.gx - 1 && gx < p.gx + p.w && gy >= p.gy - 1 && gy < p.gy + p.d)) continue
    if (hash(gx, gy, 11) < 0.16) {
      const [x, y] = iso(gx + 0.5, gy + 0.5)
      add(gx + gy + 1, () => {
        r.rect(x - 2, y - 5, 5, 4, C.juniper); r.rect(x - 1, y - 6, 3, 1, C.juniper)
        r.rect(x + 1, y - 4, 2, 3, C.juniperDark); r.px(x, y - 1, C.earthR)
      })
    }
  }

  // street lamps along Central
  for (let gx = 1; gx < GRID; gx += 3) {
    const [x, y] = iso(gx + 0.5, 9.5)
    add(gx + 9.5, () => {
      r.rect(x, y - 9, 1, 9, hex("#3b3833"))
      r.px(x + 1, y - 9, C.lamp)
      if (lit) lights.push({ x: x + 1, y: y - 9, c: C.lamp, r: 7, a: 0.35 })
    })
  }

  const P = PLACES
  // White residence: ranch house with the pool out back
  add(P.home.gx + P.home.gy + 4, () => {
    const b = P.home
    rhombus(r, b.gx + b.w, b.gy, C.pool); rhombus(r, b.gx + b.w, b.gy + 1, C.pool)
    if (lit) lights.push({ ...pt(iso(b.gx + b.w + 0.5, b.gy + 1)), c: C.poolLight, r: 7, a: 0.5 })
    box(r, b.gx, b.gy, b.w, b.d, 7, hex("#8b6a4f"), hex("#dbc9a6"), hex("#b9a582"))
    box(r, b.gx + 0.3, b.gy + 0.3, b.w - 0.6, b.d - 0.6, 10, hex("#9c7858"), hex("#7c5d44"), hex("#6a4f39"))
    windows(r, lights, b, "L", 3, 4, lit || v.skylerWaiting)
    windows(r, lights, b, "R", 2, 4, lit)
    // garage
    box(r, b.gx - 0.1, b.gy + b.d, 1.2, 0.01, 5, hex("#c9b68f"), hex("#a8946f"), hex("#a8946f"))
  })

  add(P.street.gx + P.street.gy + 4, () => {
    const b = P.street
    box(r, b.gx, b.gy, b.w, b.d, 7, hex("#6e5a4c"), hex("#b49374"), hex("#8e735a"))
    windows(r, lights, b, "L", 2, 4, lit, hex("#c89bff"))
    windows(r, lights, b, "R", 1, 4, lit)
  })

  add(P.dea.gx + P.dea.gy + 6, () => {
    const b = P.dea
    box(r, b.gx, b.gy, b.w, b.d, 16, hex("#9d978c"), hex("#c9c2b4"), hex("#a39d91"))
    for (const z of [4, 9, 13]) { windows(r, lights, b, "L", 4, z, lit && hash(z, 1) < 0.8, hex("#e8f2ff")); windows(r, lights, b, "R", 4, z, lit && hash(z, 2) < 0.6, hex("#e8f2ff")) }
    const [x, y] = iso(b.gx + 1, b.gy + 1, 16)
    r.rect(x, y - 8, 1, 8, hex("#dddddd"))
    r.rect(x + 1, y - 8, 4, 1, hex("#b83b3b")); r.rect(x + 1, y - 7, 4, 1, hex("#eeeeee")); r.rect(x + 1, y - 6, 4, 1, hex("#b83b3b"))
    r.rect(x + 1, y - 8, 2, 2, hex("#2f4a86"))
  })

  add(P.saul.gx + P.saul.gy + 6, () => {
    const b = P.saul
    box(r, b.gx, b.gy, b.w, b.d, 8, hex("#b8aa90"), hex("#e3d7bf"), hex("#c3b79f"))
    for (let i = 0; i < 16; i++) {
      const [x, y] = facePoint(b.gx, b.gy, b.w, b.d, "L", i / 16, 7)
      r.rect(x, y, 2, 2, i % 2 ? hex("#b54a3a") : hex("#e8d9b8"))
    }
    windows(r, lights, b, "L", 4, 3, lit)
    const [x, y] = iso(b.gx + 2, b.gy + 1, 8)
    r.rect(x - 4, y - 5, 9, 4, hex("#e9c24a")); r.rect(x - 3, y - 4, 7, 2, hex("#a8322e"))
    if (lit) lights.push({ x, y: y - 3, c: hex("#ffd35c"), r: 6, a: 0.5 })
  })

  add(P.pollos.gx + P.pollos.gy + 5, () => {
    const b = P.pollos
    box(r, b.gx, b.gy, b.w, b.d, 7, hex("#d8a23a"), hex("#efe6d2"), hex("#cfc3a8"))
    for (let i = 0; i < 12; i++) { const [x, y] = facePoint(b.gx, b.gy, b.w, b.d, "L", i / 12, 6); r.rect(x, y, 2, 1, hex("#c23e2c")) }
    windows(r, lights, b, "L", 3, 3, lit)
    const [x, y] = iso(b.gx + b.w + 0.3, b.gy + b.d + 0.3)
    r.rect(x, y - 16, 1, 16, hex("#5a5550"))
    r.rect(x - 3, y - 21, 7, 5, hex("#e9b534")); r.rect(x - 2, y - 20, 5, 3, hex("#c23e2c"))
    if (lit) lights.push({ x, y: y - 19, c: hex("#ffc54a"), r: 8, a: 0.55 })
  })

  add(P.carwash.gx + P.carwash.gy + 6, () => {
    const b = P.carwash
    const roof = v.ownsCarwash ? hex("#3f7fb5") : hex("#7e8a93")
    box(r, b.gx, b.gy, b.w, b.d, 6, roof, hex("#e8e2d6"), hex("#c4bdb0"))
    // open wash bay
    const [x0, y0] = facePoint(b.gx, b.gy, b.w, b.d, "L", 0.2, 0), [x1, y1] = facePoint(b.gx, b.gy, b.w, b.d, "L", 0.6, 0)
    r.poly([[x0, y0], [x1, y1], [x1, y1 - 5], [x0, y0 - 5]], hex("#39414a"))
    const [sx, sy] = iso(b.gx - 0.2, b.gy + b.d + 0.2)
    r.rect(sx, sy - 14, 1, 14, hex("#5a5550"))
    r.rect(sx - 4, sy - 19, 9, 5, v.ownsCarwash ? hex("#2f6fb0") : hex("#8d8d8d")); r.rect(sx - 3, sy - 18, 7, 1, hex("#e14b3b"))
    if (!v.ownsCarwash) { r.rect(sx + 4, sy - 5, 5, 4, hex("#efe7d6")); r.rect(sx + 5, sy - 4, 3, 1, hex("#c0392b")); r.rect(sx + 6, sy - 1, 1, 2, hex("#6b5a44")) }
    if (lit && v.ownsCarwash) lights.push({ x: sx, y: sy - 17, c: hex("#79c6ff"), r: 8, a: 0.5 })
    windows(r, lights, b, "R", 2, 3, lit && v.ownsCarwash)
  })

  add(P.superlab.gx + P.superlab.gy + 5, () => {
    const b = P.superlab
    box(r, b.gx, b.gy, b.w, b.d, 11, hex("#9f988b"), hex("#c5beb1"), hex("#a39c90"))
    windows(r, lights, b, "L", 6, 7, lit && v.superlab)
    for (let i = 0; i < 3; i++) {
      const [x, y] = iso(b.gx + 0.7 + i * 1.2, b.gy + 0.5, 11)
      r.rect(x, y - 3, 2, 3, hex("#77726a"))
      if (v.superlab && v.cookedThisWeek) steam(r, x, y - 4, v, i)
    }
    if (v.superlab && lit) {
      const [x, y] = facePoint(b.gx, b.gy, b.w, b.d, "L", 0.5, 1)
      lights.push({ x, y, c: C.blueGlow, r: 10, a: 0.35 })
    }
  })

  // the RV out past the mesa
  add(P.desert.gx + P.desert.gy + 2, () => {
    const b = P.desert
    box(r, b.gx, b.gy, 1.3, 0.8, 6, hex("#e2dccd"), hex("#eee8da"), hex("#c9c2b2"))
    const [x, y] = facePoint(b.gx, b.gy, 1.3, 0.8, "L", 0, 2)
    r.rect(x, y, 11, 1, hex("#8a5a35"))
    if (v.cookedThisWeek && !v.superlab) {
      steam(r, ...iso(b.gx + 0.8, b.gy + 0.4, 7), v, 0)
      if (lit) lights.push({ x: x + 5, y: y - 1, c: C.blueGlow, r: 7, a: 0.5 })
    }
  })

  // Walt's beige Aztek
  add(v.car.x + v.car.y + 1.2, () => car(r, lights, v.car.x, v.car.y, hex("#c2ae76"), lit))

  if (v.hankVisiting) add(3.5 + 13 + 1.2, () => car(r, lights, 3.4, 13.2, hex("#1f2124"), lit))

  if (v.heat >= 50) {
    const loop = PATROL.length
    const t = ((v.timeMs / 900) % loop + loop) % loop
    const i = Math.floor(t), f = t - i
    const a = PATROL[i], b = PATROL[(i + 1) % loop]
    const px = a[0] + (b[0] - a[0]) * f, py = a[1] + (b[1] - a[1]) * f
    add(px + py + 1.2, () => {
      car(r, lights, px, py, hex("#26282c"), lit)
      const [x, y] = iso(px + 0.5, py + 0.5)
      const on = Math.floor(v.timeMs / 250) % 2 === 0
      r.px(x - 1, y - 5, on ? hex("#ff3b3b") : hex("#7a1c1c")); r.px(x + 1, y - 5, on ? hex("#244a9a") : hex("#4a8cff"))
      if (lit) lights.push({ x, y: y - 5, c: on ? hex("#ff4b4b") : hex("#4a8cff"), r: 6, a: 0.45 })
    })
  }

  items.sort((a, b) => a.depth - b.depth)
  for (const it of items) it.draw()

  r.grade(v.night)
  for (const l of lights) {
    const a = l.a * Math.max(0, (v.night - 0.4) / 0.6)
    if (a <= 0) continue
    for (let dy = -l.r; dy <= l.r; dy++) for (let dx = -l.r; dx <= l.r; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy * 1.6) / l.r
      if (dist > 1) continue
      // stepped falloff keeps the light pixel-crisp instead of airbrushed
      const k = Math.round((1 - dist) * (1 - dist) * a * 6) / 6
      if (k <= 0) continue
      r.glow(l.x + dx, l.y + dy, l.c, Math.min(1, k))
    }
    r.px(l.x, l.y, l.c)
  }
}

function pt([x, y]: [number, number]) { return { x, y } }

function steam(r: Raster, x: number, y: number, v: SceneView, seed: number) {
  for (let k = 0; k < 4; k++) {
    const phase = v.motion ? ((v.timeMs / 600 + k * 0.25 + seed * 0.37) % 1) : k * 0.25
    const sy = Math.round(y - phase * 10)
    const sx = Math.round(x + Math.sin((phase + seed) * 6) * 1.5)
    r.glow(sx, sy, hex("#eef2f4"), 0.7 * (1 - phase))
    r.glow(sx + 1, sy, hex("#eef2f4"), 0.5 * (1 - phase))
  }
}

function car(r: Raster, lights: Light[], gx: number, gy: number, body: RGB, lit: boolean) {
  const [x, y] = iso(gx + 0.5, gy + 0.5)
  r.rect(x - 4, y, 9, 1, hex("#1c1916"))
  r.rect(x - 4, y - 3, 9, 3, body)
  r.rect(x - 4, y - 1, 9, 1, shade(body, 0.7))
  r.rect(x - 2, y - 5, 5, 2, shade(body, 0.9))
  r.rect(x - 1, y - 5, 3, 1, hex("#a8c3cf"))
  r.px(x - 3, y, hex("#111111")); r.px(x + 3, y, hex("#111111"))
  if (lit) { lights.push({ x: x + 4, y: y - 2, c: hex("#fff1c4"), r: 5, a: 0.45 }) }
}
