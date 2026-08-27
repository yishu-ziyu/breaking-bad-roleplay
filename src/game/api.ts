import type { GameResponse, Language } from './types'

async function readJson(resp: Response): Promise<GameResponse> {
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : resp.statusText
    throw new Error(detail || `Game request failed (${resp.status})`)
  }
  return body as GameResponse
}

export async function startGame(seed: number, language: Language): Promise<GameResponse> {
  return readJson(
    await fetch('/api/game/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed, language }),
    }),
  )
}

export async function playAction(gameId: string, actionId: string): Promise<GameResponse> {
  return readJson(
    await fetch(`/api/game/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_id: actionId }),
    }),
  )
}
