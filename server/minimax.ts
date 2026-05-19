export type MiniMaxChatRequest = {
  systemPrompt: string
  contextPrompt: string
}

export type RoleplayOutput = {
  reply_text: string
  emotion_state: string
  gif_search_query: string | null
}

const minimaxEndpoint = 'https://api.minimaxi.com/anthropic/v1/messages'

function extractMiniMaxText(payload: unknown): string {
  const content = (payload as { content?: Array<{ type?: string; text?: string }> }).content
  const text = content?.find((block) => block.type === 'text' && typeof block.text === 'string')?.text
  if (!text) {
    throw new Error('The MiniMax response did not contain text output.')
  }
  return text.trim()
}

function parseRoleplayOutput(text: string): RoleplayOutput {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced ?? trimmed
  try {
    return JSON.parse(candidate) as RoleplayOutput
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as RoleplayOutput
    }
    throw new Error('The MiniMax response was not valid roleplay JSON.')
  }
}

export async function callMiniMaxTokenPlan(
  apiKey: string | undefined,
  request: MiniMaxChatRequest,
): Promise<RoleplayOutput> {
  if (!apiKey) {
    throw new Error('MINIMAX_TOKEN_PLAN_KEY is not configured.')
  }

  const response = await fetch(minimaxEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.7',
      max_tokens: 1000,
      system: request.systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: request.contextPrompt,
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `MiniMax request failed with status ${response.status}.`)
  }

  return parseRoleplayOutput(extractMiniMaxText(await response.json()))
}
