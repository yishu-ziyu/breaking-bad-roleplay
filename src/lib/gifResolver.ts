import { roleAssets, type RoleAssetCharacterId, type RoleGifAsset, type RoleGifTag } from '../roleAssets'

type LS = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

const RECENT_KEY = 'abq_recent_gifs'
const WEIGHTS_KEY = 'abq_gif_weights'
export const COOLDOWN_SIZE = 3

const TAGS: RoleGifTag[] = [
  'default', 'tense', 'chemistry', 'panic', 'lawyer', 'glare', 'money',
  'desert', 'family', 'deal', 'business', 'restraint', 'confrontation',
]

const EMOTION_BRIDGE: Record<string, RoleGifTag[]> = {
  '压迫': ['glare', 'tense'],
  '开场压迫': ['glare', 'tense'],
  '焦虑': ['panic', 'tense'],
  '恐慌': ['panic'],
  '家庭': ['family'],
  '对抗': ['confrontation', 'tense'],
  '对峙': ['confrontation', 'tense'],
  'protective': ['family', 'restraint'],
  'fear': ['panic'],
  'pressure': ['tense', 'glare'],
  'defensive': ['tense', 'panic'],
  'controlled': ['restraint', 'glare'],
  'challenge': ['confrontation', 'glare'],
}

function lsAvailable(): boolean {
  return typeof globalThis !== 'undefined' && typeof (globalThis as unknown as { localStorage: LS }).localStorage !== 'undefined'
}

function lsGet(key: string): string | null {
  if (!lsAvailable()) return null
  try {
    return (globalThis as unknown as { localStorage: LS }).localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  if (!lsAvailable()) return
  try {
    (globalThis as unknown as { localStorage: LS }).localStorage.setItem(key, value)
  } catch {
    // best-effort
  }
}

function lsRemove(key: string): void {
  if (!lsAvailable()) return
  try {
    (globalThis as unknown as { localStorage: LS }).localStorage.removeItem(key)
  } catch {
    // best-effort
  }
}

function parseRecent(): Record<string, string[]> {
  const raw = lsGet(RECENT_KEY)
  if (raw) {
    try { return JSON.parse(raw) } catch { /* fall through */ }
  }
  return {}
}

function saveRecent(map: Record<string, string[]>) {
  lsSet(RECENT_KEY, JSON.stringify(map))
}

function parseWeights(): Record<string, number> {
  const raw = lsGet(WEIGHTS_KEY)
  if (raw) {
    try { return JSON.parse(raw) } catch { /* fall through */ }
  }
  return {}
}

function saveWeights(map: Record<string, number>) {
  lsSet(WEIGHTS_KEY, JSON.stringify(map))
}

function pushRecent(characterId: string, url: string) {
  const map = parseRecent()
  const list = map[characterId] ?? []
  const next = [url, ...list].slice(0, COOLDOWN_SIZE)
  map[characterId] = next
  saveRecent(map)
}

function incrementWeight(url: string) {
  const map = parseWeights()
  map[url] = (map[url] ?? 0) + 1
  saveWeights(map)
}

function tokenize(query: string | null | undefined): string[] {
  if (!query) return []
  return query.toLowerCase().split(/[^a-z0-9一-龥]+/).filter(Boolean)
}

function collectBridgeTags(tokens: string[]): RoleGifTag[] {
  const seen = new Set<RoleGifTag>()
  const result: RoleGifTag[] = []
  for (const token of tokens) {
    const mapped = EMOTION_BRIDGE[token]
    if (mapped) {
      for (const tag of mapped) {
        if (!seen.has(tag)) {
          seen.add(tag)
          result.push(tag)
        }
      }
    }
  }
  return result
}

function candidateTags(query: string | null | undefined, emotion: string | null | undefined): RoleGifTag[][] {
  const emotionTokens = tokenize(emotion)
  const queryTokens = tokenize(query)

  const bridgeFromEmotion = collectBridgeTags(emotionTokens)
  const bridgeFromQuery = collectBridgeTags(queryTokens)

  const directMatches = new Set<RoleGifTag>()
  for (const tag of TAGS) {
    if (emotionTokens.includes(tag) || queryTokens.includes(tag)) {
      directMatches.add(tag)
    }
  }

  const results: RoleGifTag[][] = []
  if (bridgeFromEmotion.length > 0) results.push(bridgeFromEmotion)
  if (bridgeFromQuery.length > 0) results.push(bridgeFromQuery)
  if (directMatches.size > 0) results.push([...directMatches])
  return results
}

function resolveBestTag(
  candidates: RoleGifTag[][],
  pool: RoleGifAsset[],
  recent: string[],
): RoleGifTag | null {
  for (const group of candidates) {
    let bestTag: RoleGifTag | null = null
    let bestFreshCount = -1
    for (const tag of group) {
      const freshCount = pool.filter(g => g.tags.includes(tag) && !recent.includes(g.url)).length
      if (freshCount > bestFreshCount) {
        bestFreshCount = freshCount
        bestTag = tag
      }
    }
    if (bestTag && bestFreshCount > 0) return bestTag
  }
  return null
}

function weightedRandom(matches: RoleGifAsset[]): typeof matches[number] {
  const weights = parseWeights()
  const entries = matches.map(g => ({
    gif: g,
    weight: 1 / ((weights[g.url] ?? 0) + 1),
  }))

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0)
  let rand = Math.random() * totalWeight
  for (const entry of entries) {
    rand -= entry.weight
    if (rand <= 0) return entry.gif
  }
  return entries[entries.length - 1].gif
}

export function resetGifResolverState(): void {
  lsRemove(RECENT_KEY)
  lsRemove(WEIGHTS_KEY)
}

export function resolveGifUrl(
  characterId: RoleAssetCharacterId,
  emotion?: string | null,
  gifQuery?: string | null,
): string | null {
  const pool = roleAssets[characterId]?.gifPools ?? []
  if (pool.length === 0) return null

  const candidates = candidateTags(gifQuery, emotion)
  const recent = parseRecent()[characterId] ?? []

  const bestTag = resolveBestTag(candidates, pool, recent)
  if (bestTag) {
    const taggedMatches = pool.filter(g => g.tags.includes(bestTag) && !recent.includes(g.url))
    if (taggedMatches.length > 0) {
      const choice = weightedRandom(taggedMatches)
      pushRecent(characterId, choice.url)
      incrementWeight(choice.url)
      return choice.url
    }
  }

  const defaultMatches = pool.filter(g => g.tags.includes('default') && !recent.includes(g.url))
  if (defaultMatches.length > 0) {
    const choice = weightedRandom(defaultMatches)
    pushRecent(characterId, choice.url)
    incrementWeight(choice.url)
    return choice.url
  }

  return null
}
