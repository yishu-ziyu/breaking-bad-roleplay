import type { CharacterId } from '../roleProfiles'
import { resolveGifUrl } from './gifResolver'

export type DirectChatBubble = {
  id: string
  sender: CharacterId | 'user'
  text: string
  emotion?: string
  gifQuery?: string | null
  gifUrl?: string | null
  thinking?: string
  toolExecuted?: string | null
  toolLog?: string | null
}

export function bubbleFromDirectPayload(
  characterId: CharacterId,
  data: Record<string, unknown>,
): DirectChatBubble {
  const text = String(data.reply_text ?? '')
  const emotion = data.emotion_state as string | undefined
  const gifQuery = (data.gif_search_query as string | null) ?? null
  return {
    id: crypto.randomUUID(),
    sender: characterId,
    text,
    emotion,
    gifQuery,
    gifUrl: resolveGifUrl(characterId, emotion ?? null, gifQuery, false, text),
    thinking: data.thinking as string | undefined,
    toolExecuted: data.tool_executed as string | null,
    toolLog: data.tool_log as string | null,
  }
}

export function bubblesFromCrewPayload(
  primaryId: CharacterId,
  data: Record<string, unknown>,
): DirectChatBubble[] {
  if (Array.isArray(data.debate_logs)) {
    return data.debate_logs.map((log: Record<string, unknown>) => {
      const sender = log.sender as CharacterId
      const text = String(log.text ?? '')
      const emotion = log.emotion as string | undefined
      const gifQuery = (log.gifQuery as string | null) ?? null
      return {
        id: crypto.randomUUID(),
        sender,
        text,
        emotion,
        gifQuery,
        gifUrl: resolveGifUrl(sender, emotion ?? null, gifQuery, false, text),
        thinking: log.thinking as string | undefined,
        toolExecuted: log.tool_executed as string | null,
        toolLog: log.tool_log as string | null,
      }
    })
  }
  if (data.reply_text) {
    return [bubbleFromDirectPayload(primaryId, data)]
  }
  return []
}
