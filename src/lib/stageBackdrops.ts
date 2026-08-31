/**
 * Stage Backdrop Routing (story-stage-v2 电影化)
 *
 * pickStageBackdrop(locationText) → 背景图 public URL 字符串（纯函数）。
 * pickStageBackdropInfo(locationText) → 附带 slugline 用的「内景/外景」label。
 * 关键词统一小写匹配；同文本命中多条路线时用 weight 裁决
 * （炸鸡后厨 > 住宅厨房 > 律师办公室 > 房车 > 沙漠，越具体越优先）。
 * 一律返回 /public 绝对路径字符串——ES import 位图会炸 tsx --test。
 */

export interface StageBackdropInfo {
  id: string
  url: string
  /** slugline 前缀，例如「内景 · 炸鸡店后厨」 */
  label: string
}

interface StageBackdropRoute extends StageBackdropInfo {
  keywords: string[]
  weight: number
}

export const STAGE_BACKDROPS: StageBackdropRoute[] = [
  {
    id: 'chicken-bar',
    url: '/backgrounds/stage-bg-chicken-bar.jpg',
    label: '内景 · 炸鸡店后厨',
    keywords: ['炸鸡', '后厨', '鸡肉', '餐厅', 'los pollos', 'pollos', 'chicken', 'fried chicken', 'fryer'],
    weight: 5,
  },
  {
    id: 'kitchen-night',
    url: '/backgrounds/stage-bg-kitchen-night.jpg',
    label: '内景 · 住宅厨房',
    keywords: ['厨房', 'kitchen', '客厅', '住宅', '家', 'home'],
    weight: 4,
  },
  {
    id: 'office-neon',
    url: '/backgrounds/stage-bg-office-neon.jpg',
    label: '内景 · 律师办公室',
    keywords: ['律师', '办公室', '事务所', 'office', 'saul', 'goodman', 'lawyer', 'attorney'],
    weight: 3,
  },
  {
    id: 'rv-interior',
    url: '/backgrounds/stage-bg-rv-interior.jpg',
    label: '内景 · 房车车厢',
    keywords: ['房车', '车厢', '实验室', 'lab', 'rv', '甲胺'],
    weight: 2,
  },
  {
    id: 'desert-night',
    url: '/backgrounds/stage-bg-desert-night.jpg',
    label: '外景 · 沙漠夜',
    keywords: ['沙漠', '外景', '荒漠', 'desert', '保留地', '公路'],
    weight: 1,
  },
]

export const STAGE_BACKDROP_FALLBACK: StageBackdropInfo = STAGE_BACKDROPS[STAGE_BACKDROPS.length - 1]

/** 短 ASCII 关键词按整词匹配，避免 "nervous" 误命中 "rv" 一类。 */
const WORD_BOUNDARY_CACHE = new Map<string, RegExp>()

function matchesKeyword(haystack: string, keyword: string): boolean {
  if (/^[a-z0-9]{1,4}$/.test(keyword)) {
    let re = WORD_BOUNDARY_CACHE.get(keyword)
    if (!re) {
      re = new RegExp(`\\b${keyword}\\b`)
      WORD_BOUNDARY_CACHE.set(keyword, re)
    }
    return re.test(haystack)
  }
  return haystack.includes(keyword)
}

function matchStageBackdrop(locationText: string): StageBackdropInfo {
  const combined = (locationText ?? '').toLowerCase()
  if (!combined.trim()) return STAGE_BACKDROP_FALLBACK
  let best: { route: StageBackdropRoute; score: number } | null = null
  for (const route of STAGE_BACKDROPS) {
    let score = 0
    for (const keyword of route.keywords) {
      if (matchesKeyword(combined, keyword)) score += route.weight
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { route, score }
    }
  }
  return best ? best.route : STAGE_BACKDROP_FALLBACK
}

/** 场景文本 → 背景图 URL（无命中/空文本兜底沙漠夜）。 */
export function pickStageBackdrop(locationText: string): string {
  return matchStageBackdrop(locationText).url
}

/** 同上，附带 slugline 用的「内景/外景」label。 */
export function pickStageBackdropInfo(locationText: string): StageBackdropInfo {
  return matchStageBackdrop(locationText)
}
