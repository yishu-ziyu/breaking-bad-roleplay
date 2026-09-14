/** Pack a Direct transcript so the model still sees the opening after the recent window. */

export const DIRECT_RECENT_TURNS = 10
const DIGEST_BUDGET = 1200
const DIGEST_LINE = 140

export type DirectMemoryTurn = {
  sender: string
  text: string
}

export type DirectChatMemory = {
  opening: DirectMemoryTurn[]
  digest: string
  recent: DirectMemoryTurn[]
}

/** Outgoing /api/chat fields. Mirrors backend ChatRequest memory + history. */
export type DirectChatMemoryWire = {
  history: DirectMemoryTurn[]
  memoryOpening: DirectMemoryTurn[]
  memoryDigest?: string
}

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function compactDigest(turns: DirectMemoryTurn[]): string {
  if (turns.length === 0) return ''
  const line = (t: DirectMemoryTurn) =>
    `${t.sender === 'user' ? 'Player' : 'You'}: ${clip(t.text, DIGEST_LINE)}`
  const full = turns.map(line).join('\n')
  if (full.length <= DIGEST_BUDGET) return full
  if (turns.length <= 4) return turns.map(line).join('\n').slice(0, DIGEST_BUDGET)
  const omitted = turns.length - 4
  const kept = [...turns.slice(0, 2), ...turns.slice(-2)]
  return [
    ...kept.slice(0, 2).map(line),
    `(${omitted} turns omitted)`,
    ...kept.slice(2).map(line),
  ].join('\n')
}

export function buildDirectChatMemory(messages: DirectMemoryTurn[]): DirectChatMemory {
  const turns = messages
    .map((m) => ({ sender: m.sender, text: (m.text ?? '').trim() }))
    .filter((m) => m.text.length > 0)

  if (turns.length <= DIRECT_RECENT_TURNS) {
    return { opening: [], digest: '', recent: turns }
  }

  const recentStart = turns.length - DIRECT_RECENT_TURNS
  const recent = turns.slice(recentStart)
  const firstUser = turns.findIndex((t) => t.sender === 'user')
  const opening: DirectMemoryTurn[] = []
  if (firstUser >= 0 && firstUser < recentStart) {
    opening.push(turns[firstUser])
    const replyIdx = firstUser + 1
    if (replyIdx < recentStart && turns[replyIdx]?.sender !== 'user') {
      opening.push(turns[replyIdx])
    }
  }
  const middleStart = firstUser < 0
    ? 0
    : Math.min(firstUser + opening.length, recentStart)
  const middle = turns.slice(middleStart, recentStart)
  return {
    opening,
    digest: compactDigest(middle),
    recent,
  }
}

export function toDirectChatMemoryWire(
  mode: string,
  messages: DirectMemoryTurn[],
): DirectChatMemoryWire {
  if (mode !== 'direct') {
    return {
      history: messages
        .map((m) => ({ sender: m.sender, text: (m.text ?? '').trim() }))
        .filter((m) => m.text.length > 0)
        .slice(-DIRECT_RECENT_TURNS),
      memoryOpening: [],
    }
  }
  const packed = buildDirectChatMemory(messages)
  return {
    history: packed.recent,
    memoryOpening: packed.opening,
    ...(packed.digest ? { memoryDigest: packed.digest } : {}),
  }
}
