/** Story 阅读: continuous prose, highlighted dialogue, on-stage lore, beat redraw. */

import type { StoryEvent } from './storyFeed'

export type ReadingBlockKind = 'narration' | 'dialogue' | 'player'

export type ReadingBlock = {
  id: string
  kind: ReadingBlockKind
  text: string
  source: 'user' | 'model'
  speaker?: string
  /** The player line is sent but the server has not confirmed it yet: it is a
   * claim, not committed story text, and must not read like settled history. */
  pending?: boolean
}

export type OnStageLore = {
  facts: string[]
  location: string | null
  expanded: boolean
}

export function buildReadingBlocks(
  events: readonly StoryEvent[],
  lang: 'zh' | 'en' = 'en',
): ReadingBlock[] {
  const stageLang: StageLang = lang === 'zh' ? 'zh' : 'en'
  const blocks: ReadingBlock[] = []
  events.forEach((evt, i) => {
    if (evt.type === 'world_state_delta' || evt.type === 'beat_ready' || evt.type === 'status' || evt.type === 'outline' || evt.type === 'complete' || evt.type === 'error') {
      return
    }
    if (evt.type === 'agent_speak') {
      const text = String(evt.data.content ?? '').trim()
      if (!text) return
      blocks.push({
        id: `read-${i}-dialogue`,
        kind: 'dialogue',
        text,
        source: 'model',
        speaker: String(evt.data.character_id ?? ''),
      })
      return
    }
    if (evt.type === 'player_turn') {
      const text = inWorldPlayerLine(
        String(evt.data.content ?? ''),
        String(evt.data.kind ?? ''),
        lang,
      )
      if (!text) return
      blocks.push({
        id: `read-${i}-player`,
        kind: 'player',
        text,
        source: 'user',
        pending: evt.data.pending === true,
      })
      return
    }
    const text = narrationText(evt, stageLang)
    if (!text) return
    blocks.push({
      id: `read-${i}-narration`,
      kind: 'narration',
      text,
      source: 'model',
      speaker: typeof evt.data.character_id === 'string' ? evt.data.character_id : undefined,
    })
  })
  return blocks
}

export function extractOnStageLore(
  events: readonly StoryEvent[],
  lang: 'zh' | 'en' = 'en',
): OnStageLore {
  const facts: string[] = []
  let location: string | null = null
  for (const evt of events) {
    if (evt.type === 'scene_change') {
      const dest = typeof evt.data.to_scene === 'string' ? evt.data.to_scene : ''
      const desc = playerFacing(String(evt.data.description ?? ''))
      const label = playerFacingLocation(dest, lang)
      location = (label || desc || location || '').trim() || location
    }
    if (evt.type !== 'world_state_delta') continue
    const deltas = evt.data.deltas
    if (!Array.isArray(deltas)) continue
    for (const raw of deltas) {
      if (!raw || typeof raw !== 'object') continue
      const d = raw as Record<string, unknown>
      const fact = formatOnStageFact(d, lang)
      if (fact) facts.push(fact)
    }
  }
  return {
    facts,
    location,
    expanded: facts.length > 0,
  }
}

export function beatNumberFromId(beatId: unknown): number | null {
  if (typeof beatId !== 'string') return null
  const match = beatId.match(/^beat[_-](\d+)$/i)
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function canonicalBeatId(beatId: string | null, beatIndex: number): string {
  const n = beatNumberFromId(beatId) ?? (beatIndex > 0 ? beatIndex : 1)
  return `beat_${n}`
}

export function trimFeedForBeatRedraw(
  events: readonly StoryEvent[],
  beatId: string,
): StoryEvent[] {
  const n = beatNumberFromId(beatId)
  if (n == null || n <= 1) return []
  const prevIds = new Set([`beat_${n - 1}`, `beat-${n - 1}`])
  let cut = -1
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].type === 'beat_ready' && prevIds.has(String(events[i].data.beat_id ?? ''))) {
      cut = i
    }
  }
  if (cut < 0) return []
  return events.slice(0, cut + 1)
}

export function trimFeedThroughBeat(
  events: readonly StoryEvent[],
  beatId: string,
): StoryEvent[] {
  const target = beatNumberFromId(beatId)
  if (target == null) return [...events]
  let cut = -1
  for (let i = 0; i < events.length; i += 1) {
    if (
      events[i].type === 'beat_ready'
      && beatNumberFromId(events[i].data.beat_id) === target
    ) {
      cut = i
    }
  }
  return cut < 0 ? [...events] : events.slice(0, cut + 1)
}

export function looksLikePlotEngineCopy(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t.includes('→') || t.includes('->')) return true
  if (/点破压力点|立刻采取行动应对|（针对：/.test(t)) return true
  if (/force a clear answer about:|take a concrete move on:|study the room \(re:/i.test(t)) return true
  if (/上场的事实|world_state|beat_id|redirect_prompt/i.test(t)) return true
  return false
}

const FALLBACK_PLAYER = {
  zh: {
    say: '我提高声音，朝黑暗里喊他。',
    do: '我不再空谈，先改眼前的事。',
    observe: '我先不说话，把每个人的反应看清楚。',
    free: '我把这一步做了。',
  },
  en: {
    say: 'I raise my voice and call into the dark.',
    do: 'I stop talking and move on what is in front of me.',
    observe: 'I hold still and watch every face before I commit.',
    free: 'I take the next step myself.',
  },
} as const

export function inWorldPlayerLine(
  text: string,
  kind: string = '',
  lang: 'zh' | 'en' = 'zh',
): string {
  const raw = text.trim()
  if (!raw || looksLikePlotEngineCopy(raw)) {
    const key = kind === 'do' || kind === 'observe' || kind === 'say' ? kind : 'free'
    return FALLBACK_PLAYER[lang][key]
  }
  return raw
}

function formatOnStageFact(d: Record<string, unknown>, lang: 'zh' | 'en'): string | null {
  const target = String(d.target ?? d.entity ?? '').trim()
  const field = String(d.field ?? '').trim()
  const newValue = String(d.new_value ?? '').trim()
  if (!target && !newValue) return null
  const who = target || (lang === 'zh' ? '有人' : 'Someone')
  const whereLike = /下落|where|location|scene|place/i.test(field)
  if (lang === 'zh') {
    if (whereLike) return `${who}已经到了${newValue || '别处'}`
    if (newValue) return `${who}已经是${newValue}`
    return who
  }
  if (whereLike) return `${who} is in ${newValue || 'the dark'}`
  if (newValue) return `${who} is ${newValue}`
  return who
}

/* ------------------------------------------------------------------ */
/* Stage directions: character_policy emits machine verbs (look_at →    */
/* walter). The manuscript is prose for the player, so those verbs are  */
/* rendered as localized sentences — or dropped, never printed raw.     */
/* ------------------------------------------------------------------ */

type StageLang = 'zh' | 'en'

const STAGE_NAMES: Record<string, Record<StageLang, string>> = {
  'walter white': { zh: '沃尔特', en: 'Walter' },
  walter: { zh: '沃尔特', en: 'Walter' },
  'jesse pinkman': { zh: '杰西', en: 'Jesse' },
  jesse: { zh: '杰西', en: 'Jesse' },
  'skyler white': { zh: '斯凯勒', en: 'Skyler' },
  skyler: { zh: '斯凯勒', en: 'Skyler' },
  'saul goodman': { zh: '索尔', en: 'Saul' },
  saul: { zh: '索尔', en: 'Saul' },
  'mike ehrmantraut': { zh: '迈克', en: 'Mike' },
  mike: { zh: '迈克', en: 'Mike' },
  'gus fring': { zh: '古斯', en: 'Gus' },
  gus: { zh: '古斯', en: 'Gus' },
  'hank schrader': { zh: '汉克', en: 'Hank' },
  hank: { zh: '汉克', en: 'Hank' },
  'marie schrader': { zh: '玛丽', en: 'Marie' },
  marie: { zh: '玛丽', en: 'Marie' },
}

/** Internal location ids that must never surface in the HUD / lore panel. */
const STAGE_PLACES: Record<string, Record<StageLang, string>> = {
  scene: { zh: '现场', en: 'Story scene' },
  desert: { zh: '荒漠', en: 'the desert' },
  rv: { zh: '房车', en: 'the RV' },
}

const STAGE_VERBS: Record<string, Record<StageLang, string>> = {
  look_at: { zh: '{actor}看向{target}', en: '{actor} looks at {target}' },
  turn_to: { zh: '{actor}转向{target}', en: '{actor} turns to {target}' },
  walk_to: { zh: '{actor}走向{target}', en: '{actor} walks toward {target}' },
  enter: { zh: '{actor}走进来', en: '{actor} enters' },
  exit: { zh: '{actor}离开', en: '{actor} leaves' },
  sit: { zh: '{actor}坐下', en: '{actor} sits down' },
  stand: { zh: '{actor}站起身', en: '{actor} stands up' },
  gesture: { zh: '{actor}做了个手势', en: '{actor} gestures' },
  hand_over: { zh: '{actor}递出手里的东西', en: '{actor} hands something over' },
  open: { zh: '{actor}打开', en: '{actor} opens' },
  close: { zh: '{actor}合上', en: '{actor} closes' },
  idle: { zh: '{actor}没有动', en: '{actor} holds still' },
  idle_tense: { zh: '{actor}绷着没有动', en: '{actor} holds still, tense' },
}

const STAGE_TARGET_FALLBACK: Record<StageLang, string> = {
  zh: '对面',
  en: 'the other side',
}

function humanizeStageId(value: string): string {
  return value.replace(/_/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())
}

function stageName(id: string, lang: StageLang): string {
  const raw = id.trim()
  if (!raw) return ''
  const key = raw.toLowerCase()
  const known = STAGE_NAMES[key] ?? STAGE_NAMES[key.split(' ')[0]]
  if (known) return known[lang]
  const place = STAGE_PLACES[key]
  if (place) return place[lang]
  return humanizeStageId(raw)
}

function stageTarget(id: string, lang: StageLang): string {
  return stageName(id, lang) || STAGE_TARGET_FALLBACK[lang]
}

function renderStageVerb(
  verb: string,
  actorId: string,
  targetId: string,
  lang: StageLang,
): string {
  const template = STAGE_VERBS[verb]
  if (!template) return ''
  const actor = stageName(actorId, lang)
  const target = targetId ? stageTarget(targetId, lang) : STAGE_TARGET_FALLBACK[lang]
  return template[lang].replace('{actor}', actor).replace('{target}', target)
}

/** Verb with an optional `→ target` and `(anchor)` suffix (character_policy). */
const STAGE_STRUCTURED = /^([a-z][a-z0-9_]*)\s*(?:(?:→|->)\s*([^\s(]+))?\s*(?:\(([^)]*)\))?$/
const STAGE_MACHINE_TOKEN = /^[a-z][a-z0-9]*_[a-z0-9_]+$/

function stageDirectionText(
  action: string,
  characterId: string,
  lang: StageLang,
): string {
  const structured = action.match(STAGE_STRUCTURED)
  if (structured && (structured[2] || STAGE_MACHINE_TOKEN.test(structured[1]))) {
    const text = renderStageVerb(
      structured[1],
      characterId,
      structured[2] ?? structured[3] ?? '',
      lang,
    )
    return text ? `〔${text}〕` : ''
  }
  if (STAGE_MACHINE_TOKEN.test(action)) {
    const text = renderStageVerb(action, characterId, '', lang)
    return text ? `〔${text}〕` : ''
  }
  const bare = action.replace(/^[〔[]/, '').replace(/[〕\]]$/, '')
  return `〔${bare}〕`
}

function narrationText(evt: StoryEvent, lang: StageLang): string {
  if (evt.type === 'scene_change') {
    return playerFacing(String(evt.data.description ?? ''))
  }
  if (evt.type === 'agent_think') {
    const thought = String(evt.data.thought_content ?? '').trim()
    return thought
  }
  if (evt.type === 'agent_act') {
    const action = String(evt.data.action ?? '').trim()
    if (!action) return ''
    return stageDirectionText(action, String(evt.data.character_id ?? ''), lang)
  }
  return ''
}

function playerFacing(raw: string): string {
  return raw
    .replace(/^Transitioning to:\s*/i, '')
    .replace(/^切换至[：:]\s*/, '')
    .replace(/〔\s*turn_to\s*→\s*[^〕]*〕/gi, '')
    .replace(/\[\s*turn_to\s*→\s*[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Keep a legacy payload (raw internal id) out of the HUD / lore panel. */
function playerFacingLocation(value: string, lang: 'zh' | 'en'): string {
  const raw = value.trim()
  if (!raw) return ''
  const label = STAGE_PLACES[raw.toLowerCase()]
  return label ? label[lang] : raw
}
