import { callMiniMaxTokenPlan, type MiniMaxChatRequest } from '../server/minimax'

type VercelRequest = {
  method?: string
  body?: unknown
}

type VercelResponse = {
  status: (code: number) => VercelResponse
  json: (body: unknown) => void
}

function isChatRequest(body: unknown): body is MiniMaxChatRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    'systemPrompt' in body &&
    'contextPrompt' in body &&
    typeof body.systemPrompt === 'string' &&
    typeof body.contextPrompt === 'string'
  )
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' })
    return
  }

  if (!isChatRequest(request.body)) {
    response.status(400).json({ error: 'Invalid chat request body.' })
    return
  }

  try {
    const output = await callMiniMaxTokenPlan(process.env.MINIMAX_TOKEN_PLAN_KEY, request.body)
    response.status(200).json(output)
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unknown MiniMax request error.' })
  }
}
