/**
 * Seeded RNG (mulberry32) whose whole state is one uint32 kept in GameState,
 * so a run is fully described by its seed plus its command list.
 * Never call Math.random() inside the sim.
 */
export function roll(state: { rng: number }): number {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0
  let t = state.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function seedState(seed: number): number {
  return (seed ^ 0x9e3779b1) >>> 0
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}
