import { callMiniMaxTokenPlan, type MiniMaxChatRequest } from '../server/minimax'
import { DirectorAgent } from '../server/agents/DirectorAgent'
import type { AgentRuntimeRequest } from '../server/agents/types'

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

function isAgentRuntimeRequest(body: unknown): body is AgentRuntimeRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { agentRuntimeEnabled?: unknown }).agentRuntimeEnabled === true &&
    typeof (body as { characterId?: unknown }).characterId === 'string' &&
    typeof (body as { userText?: unknown }).userText === 'string' &&
    typeof (body as { relation?: unknown }).relation === 'string' &&
    ((body as { mode?: unknown }).mode === 'direct' || (body as { mode?: unknown }).mode === 'crew') &&
    ((body as { language?: unknown }).language === 'en' || (body as { language?: unknown }).language === 'zh') &&
    Array.isArray((body as { history?: unknown }).history) &&
    typeof (body as { relationshipStates?: unknown }).relationshipStates === 'object'
  )
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' })
    return
  }

  if (isAgentRuntimeRequest(request.body)) {
    try {
      const output = await new DirectorAgent(process.env.MINIMAX_TOKEN_PLAN_KEY).runAgentTurn(request.body)
      response.status(200).json(output)
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : 'Unknown agent runtime error.' })
    }
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
