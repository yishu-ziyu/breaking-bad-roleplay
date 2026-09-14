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
  protective: ['family', 'restraint'],
  fear: ['panic'],
  fearful: ['panic', 'tense'],
  pressure: ['tense', 'glare'],
  defensive: ['tense', 'panic'],
  controlled: ['restraint', 'glare'],
  challenge: ['confrontation', 'glare'],
  calm: ['restraint'],
  tense: ['tense', 'glare'],
  angry: ['confrontation', 'glare'],
  manipulative: ['glare', 'restraint'],
  guilty: ['family', 'restraint'],
  resigned: ['restraint'],
  desperate: ['panic', 'tense'],
  lecturing: ['chemistry', 'glare'],
  smug: ['restraint', 'glare'],
}

/** Scene words in emotion / query / reply → tags. Longer keys first. */
const SCENE_LEXICON: Array<{ tags: RoleGifTag[]; keys: string[] }> = [
  { tags: ['chemistry'], keys: ['methylamine', 'chemistry', 'beaker', 'formula', 'lab', 'cook', '发烟硫酸', '蓝色那个', '实验室', '化学', '硫酸', '产率', '搅拌', '温度', '步骤'] },
  { tags: ['family'], keys: ['walter jr', 'skyler', 'hank', 'marie', 'flynn', 'family', 'dinner', '斯凯勒', '小飞', '汉克', '玛丽', '家庭', '吃饭', '妻子', '孩子'] },
  { tags: ['desert'], keys: ['albuquerque', 'desert', 'standoff', '新墨西哥', '房车', '沙漠', '土路', 'rv'] },
  { tags: ['money'], keys: ['laundry', 'money', 'cash', '通风管', '洗衣', '现金', '钱'] },
  { tags: ['lawyer'], keys: ['lawyer', 'saul', 'bail', '律师', '合同', '保释'] },
  { tags: ['business'], keys: ['business', 'deal', 'gus', '古斯', '交易', '份额'] },
  { tags: ['panic'], keys: ['dea', 'cops', 'police', '警察', '完蛋', '逃'] },
]

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

const GUN_MEME_RE = /gun|pistol|rifle|weapon|firearm|举枪|手枪/i

export function isGunMemeQuery(query: string | null | undefined): boolean {
  if (!query) return false
  return GUN_MEME_RE.test(query)
}

export function sanitizeGifQuery(query: string | null | undefined): string | null | undefined {
  if (query == null || query === '') return query
  if (isGunMemeQuery(query)) return 'tense'
  return query
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

function collectLexiconTags(haystack: string): RoleGifTag[] {
  const lower = haystack.toLowerCase()
  const seen = new Set<RoleGifTag>()
  const result: RoleGifTag[] = []
  for (const row of SCENE_LEXICON) {
    if (!row.keys.some((key) => lower.includes(key))) continue
    for (const tag of row.tags) {
      if (!seen.has(tag)) {
        seen.add(tag)
        result.push(tag)
      }
    }
  }
  return result
}

type WantedLayers = { scene: RoleGifTag[]; mood: RoleGifTag[] }

function wantedTags(
  query: string | null | undefined,
  emotion: string | null | undefined,
  replyText?: string | null,
): WantedLayers {
  const emotionTokens = tokenize(emotion)
  const queryTokens = tokenize(query)
  const replyTokens = tokenize(replyText)
  const haystack = [emotion, query, replyText].filter(Boolean).join('\n')

  const scene: RoleGifTag[] = []
  const mood: RoleGifTag[] = []
  const seenScene = new Set<RoleGifTag>()
  const seenMood = new Set<RoleGifTag>()
  const pushScene = (tags: RoleGifTag[]) => {
    for (const tag of tags) {
      if (!seenScene.has(tag)) {
        seenScene.add(tag)
        scene.push(tag)
      }
    }
  }
  const pushMood = (tags: RoleGifTag[]) => {
    for (const tag of tags) {
      if (!seenMood.has(tag) && !seenScene.has(tag)) {
        seenMood.add(tag)
        mood.push(tag)
      }
    }
  }

  pushScene(collectLexiconTags(haystack))
  for (const tag of TAGS) {
    if (tag === 'default') continue
    if (queryTokens.includes(tag) || replyTokens.includes(tag)) pushScene([tag])
  }

  if (emotion) pushMood(EMOTION_BRIDGE[emotion.toLowerCase()] ?? [])
  pushMood(collectBridgeTags(emotionTokens))
  pushMood(collectBridgeTags(queryTokens))
  for (const tag of TAGS) {
    if (emotionTokens.includes(tag)) pushMood([tag])
  }
  return { scene, mood }
}

function scoreGif(gif: RoleGifAsset, wanted: WantedLayers): number {
  let score = 0
  for (const tag of gif.tags) {
    if (wanted.scene.includes(tag)) score += 6
    else if (wanted.mood.includes(tag) && tag !== 'default') score += 2
    else if (tag === 'default' && wanted.scene.length === 0) score += 1
  }
  return score
}

function pickScored(
  pool: RoleGifAsset[],
  wanted: WantedLayers,
  recent: string[],
  chooseAndRecord: (matches: RoleGifAsset[]) => string | null,
): string | null {
  const eligible = pool.filter((g) => !recent.includes(g.url))
  const ranked = (eligible.length > 0 ? eligible : pool)
    .map((gif) => ({ gif, score: scoreGif(gif, wanted) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
  if (ranked.length === 0) return null
  const top = ranked[0].score
  return chooseAndRecord(ranked.filter((row) => row.score === top).map((row) => row.gif))
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
  skipGif?: boolean,
  replyText?: string | null,
): string | null {
  if (skipGif) return null
  const fullPool = roleAssets[characterId]?.gifPools ?? []
  const pool = isGunMemeQuery(gifQuery)
    ? (fullPool.filter((g) => !g.tags.includes('confrontation')).length > 0
      ? fullPool.filter((g) => !g.tags.includes('confrontation'))
      : fullPool)
    : fullPool
  if (pool.length === 0) return null

  const wanted = wantedTags(sanitizeGifQuery(gifQuery) ?? null, emotion, replyText)
  const recent = parseRecent()[characterId] ?? []
  const chooseAndRecord = (matches: RoleGifAsset[]): string | null => {
    if (matches.length === 0) return null
    const choice = weightedRandom(matches)
    pushRecent(characterId, choice.url)
    incrementWeight(choice.url)
    return choice.url
  }

  const scored = pickScored(pool, wanted, recent, chooseAndRecord)
  if (scored) return scored

  const defaultMatches = pool.filter(g => g.tags.includes('default') && !recent.includes(g.url))
  const defaultUrl = chooseAndRecord(defaultMatches)
  if (defaultUrl) return defaultUrl

  const scoredAgain = pickScored(pool, wanted, [], chooseAndRecord)
  if (scoredAgain) return scoredAgain

  const defaultPool = pool.filter(g => g.tags.includes('default'))
  const fallbackUrl = chooseAndRecord(defaultPool)
  if (fallbackUrl) return fallbackUrl
  return chooseAndRecord(pool)
}
