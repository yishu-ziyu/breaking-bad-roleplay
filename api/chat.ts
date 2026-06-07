import { AgentContainer } from '../server/agents/AgentContainer';
import { DirectorAgent } from '../server/agents/DirectorAgent';

type VercelRequest = {
  method?: string;
  body?: Record<string, unknown>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const { characterId, userInput, relation, mode, history, language, llmProvider, voiceExample } = request.body || {};

  if (!userInput) {
    response.status(400).json({ error: 'userInput is required.' });
    return;
  }

  try {
    if (mode === 'crew') {
      // Crew Mode: background debate (Design C)
      const director = new DirectorAgent();

      // Determine debate participants dynamically based on who is mentioned or standard pairs
      let participants = ['walter', 'jesse'];
      const text = (userInput as string).toLowerCase();
      if (text.includes('saul') || characterId === 'saul') participants.push('saul');
      if (text.includes('mike') || characterId === 'mike') participants.push('mike');
      if (text.includes('gus') || characterId === 'gus') participants.push('gus');
      if (text.includes('skyler') || characterId === 'skyler') participants.push('skyler');

      // Ensure we have unique speakers, up to 3
      participants = Array.from(new Set([characterId as string || 'walter', ...participants])).slice(0, 3);

      const debateLogs = await director.runBackgroundAgentDebate(
        userInput as string,
        participants,
        relation as string || 'partner',
        (llmProvider as string) || 'mimo'
      );

      response.status(200).json({
        scene_goal: `Debating: "${(userInput as string).slice(0, 50)}..."`,
        tension_note: `${participants.join(' & ')} clash on priority and exposure.`,
        debate_logs: debateLogs,
        participants
      });
    } else {
      // Private Mode: ReAct cognitive turn (Design A)
      const activeChar = (characterId as string) || 'walter';
      const agent = new AgentContainer(activeChar);

      const result = await agent.runCognitiveLoop(userInput as string, {
        activePeerId: (relation as string) || 'partner',
        language: (language as string) || 'zh',
        history: (history as unknown[]) || [],
        llmProvider: (llmProvider as string) || 'mimo',
        // P0-H: 把关系 Original example 一并送进 cognitive loop
        voiceExample: (voiceExample as string) || undefined,
      });

      response.status(200).json(result);
    }
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unknown agent execution error.' });
  }
}
