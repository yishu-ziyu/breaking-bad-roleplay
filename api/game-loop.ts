import { DirectorAgent } from '../server/agents/DirectorAgent';

type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST' && request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const director = new DirectorAgent();
    const result = await director.advanceClockTick();
    response.status(200).json({
      story_tick: result.tick,
      spawned_event: result.event,
      global_relationship_states: result.globalStates
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unknown game loop tick error.' });
  }
}
