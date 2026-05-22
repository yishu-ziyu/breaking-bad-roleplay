import { DirectorAgent } from '../server/agents/DirectorAgent'

type VercelRequest = {
  method?: string
  body?: unknown
}

type VercelResponse = {
  status: (code: number) => VercelResponse
  json: (body: unknown) => void
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const mode = (request.body as { mode?: unknown } | undefined)?.mode === 'crew' ? 'crew' : 'direct'
  try {
    response.status(200).json(new DirectorAgent().advanceClockTick(mode))
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unknown game loop error.' })
  }
}
