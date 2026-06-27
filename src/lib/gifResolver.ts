import { roleAssets, type RoleAssetCharacterId, type RoleGifTag } from '../roleAssets'

const RECENT_KEY = 'abq_recent_gifs'
const COOLDOWN_SIZE = 2

const TAGS: RoleGifTag[] = [
  'default', 'tense', 'chemistry', 'panic', 'lawyer', 'glare', 'money',
  'desert', 'family', 'deal', 'business', 'restraint', 'confrontation',
]

let memoryRecent: Record<string, string[]> = {}

function storageAvailable(): boolean {
  return typeof localStorage !== 'undefined'
}

function parseRecent(): Record<string, string[]> {
  if (!storageAvailable()) return memoryRecent
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '{}')
  } catch {
    return memoryRecent
  }
}

function saveRecent(map: Record<string, string[]>) {
  memoryRecent = map
  if (!storageAvailable()) return
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(map))
  } catch {}
}

function pushRecent(characterId: string, url: string) {
  const map = parseRecent()
  const list = map[characterId] ?? []
  const next = [url, ...list].slice(0, COOLDOWN_SIZE)
  map[characterId] = next
  saveRecent(map)
}

function tokenize(query: string | null | undefined): string[] {
  if (!query) return []
  return query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(Boolean)
}

function findTag(query: string | null | undefined, emotion: string | null | undefined): RoleGifTag | null {
  const tokens = tokenize(query)
  for (const tag of TAGS) {
    if (tokens.includes(tag)) return tag
  }
  const emotionTokens = tokenize(emotion)
  for (const tag of TAGS) {
    if (emotionTokens.includes(tag)) return tag
  }
  return null
}

export function resolveGifUrl(
  characterId: RoleAssetCharacterId,
  emotion?: string | null,
  gifQuery?: string | null,
): string | null {
  const pool = roleAssets[characterId]?.gifPools ?? []
  if (pool.length === 0) return null

  const tag = findTag(gifQuery, emotion) ?? 'default'
  const recent = parseRecent()[characterId] ?? []

  let matches = pool.filter(g => g.tags.includes(tag))
  if (matches.length === 0) matches = pool.filter(g => g.tags.includes('default'))
  if (matches.length === 0) matches = pool

  const fresh = matches.filter(g => !recent.includes(g.url))
  const choice = fresh.length > 0 ? fresh[0] : matches[0]
  if (!choice) return null

  pushRecent(characterId, choice.url)
  return choice.url
}
