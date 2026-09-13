/** New-user play entry: Direct / Crew without finishing Story cold open. */

export type PlaySurface = 'story' | 'direct' | 'crew'

export function playSurfaceFromSearch(search: string): 'direct' | 'crew' | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('surface')
  if (raw === 'direct' || raw === 'crew') return raw
  return null
}

export function applyPlaySurfaceToStorage(
  search: string,
  write: (key: string, value: unknown) => void,
): 'direct' | 'crew' | null {
  const surface = playSurfaceFromSearch(search)
  if (!surface) return null
  write('enteredWorld', true)
  write('surface', surface)
  return surface
}
