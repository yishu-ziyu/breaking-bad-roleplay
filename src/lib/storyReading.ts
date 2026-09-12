/** Story 阅读: continuous prose, highlighted dialogue, on-stage lore, beat redraw. */

import type { StoryEvent } from './storyFeed'

export type ReadingBlockKind = 'narration' | 'dialogue' | 'player'

export type ReadingBlock = {
  id: string
  kind: ReadingBlockKind
  text: string
  source: 'user' | 'model'
  speaker?: string
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
  void lang
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
      const text = String(evt.data.content ?? '').trim()
      if (!text) return
      blocks.push({
        id: `read-${i}-player`,
        kind: 'player',
        text,
        source: 'user',
      })
      return
    }
    const text = narrationText(evt)
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
      location = (dest || desc || location || '').trim() || location
    }
    if (evt.type !== 'world_state_delta') continue
    const deltas = evt.data.deltas
    if (!Array.isArray(deltas)) continue
    for (const raw of deltas) {
      if (!raw || typeof raw !== 'object') continue
      const d = raw as Record<string, unknown>
      const target = String(d.target ?? d.entity ?? '').trim()
      const field = String(d.field ?? '').trim()
      if (!target && !field) continue
      const oldValue = String(d.old_value ?? '∅')
      const newValue = String(d.new_value ?? '∅')
      facts.push(
        lang === 'zh'
          ? `${target || '局面'} · ${field} ${oldValue} → ${newValue}`
          : `${target || 'Board'} · ${field} ${oldValue} → ${newValue}`,
      )
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

function narrationText(evt: StoryEvent): string {
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
    const bare = action.replace(/^[〔[]/, '').replace(/[〕\]]$/, '')
    return `〔${bare}〕`
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
