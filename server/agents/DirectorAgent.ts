import fs from 'fs';
import path from 'path';
import { AgentContainer } from './AgentContainer';
import type { RelationshipState } from './AgentContainer';

export interface StoryEvent {
  type: 'DEA_SWEEP' | 'PRECURSOR_SEIZURE' | 'LOCKDOWN';
  description: string;
}

export interface DebateLogEntry {
  sender: string;
  text: string;
  emotion: string;
  gifQuery: string | null;
  tool_executed: string | null;
  tool_log: string | null;
  updated_relationship_state: RelationshipState;
  thinking: string;
}

export class DirectorAgent {
  private activeAgents: Map<string, AgentContainer>;
  private storyTick: number = 0;
  private stateFilePath: string;

  constructor() {
    const memoryDir = path.join(process.cwd(), 'server', 'agents', 'memory');
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
    this.stateFilePath = path.join(memoryDir, 'director_state.json');
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf-8'));
        this.storyTick = state.tick || 0;
      } catch {
        this.storyTick = 0;
      }
    }

    this.activeAgents = new Map([
      ['walter', new AgentContainer('walter')],
      ['jesse', new AgentContainer('jesse')],
      ['saul', new AgentContainer('saul')],
      ['mike', new AgentContainer('mike')],
      ['gus', new AgentContainer('gus')],
      ['skyler', new AgentContainer('skyler')]
    ]);
  }

  public async advanceClockTick(): Promise<{ tick: number; event: StoryEvent | null; globalStates: Record<string, Record<string, RelationshipState>> }> {
    this.storyTick += 1;
    fs.writeFileSync(this.stateFilePath, JSON.stringify({ tick: this.storyTick }));
    let spawnedEvent: StoryEvent | null = null;

    // 20% chance or every 5 ticks triggers a macro story event (Design C)
    if (this.storyTick % 5 === 0) {
      spawnedEvent = this.spawnRandomEvent();
      this.applyEventGlobalSideEffects(spawnedEvent);
    }

    // Load global state dossier status for each agent to feed back to frontend
    const globalStates: Record<string, Record<string, RelationshipState>> = {};
    for (const [id, agent] of this.activeAgents.entries()) {
      // Find representative relationship status (we can average them or take jesse/walter's view)
      const dossiers = agent.loadAllDossiers();
      const representation: Record<string, RelationshipState> = {};
      dossiers.forEach(d => {
        representation[d.peer_id] = d.relationship_state;
      });
      globalStates[id] = representation;
    }

    return {
      tick: this.storyTick,
      event: spawnedEvent,
      globalStates
    };
  }

  public async runBackgroundAgentDebate(topic: string, characters: string[], activePeerId: string = 'user', llmProvider: string = 'mimo'): Promise<DebateLogEntry[]> {
    const debateLogs: DebateLogEntry[] = [];
    let lastReply = topic;

    // NPCs talk back and forth for up to 3 turns
    for (let turn = 0; turn < 3; turn++) {
      const activeChar = characters[turn % characters.length];
      const agent = this.activeAgents.get(activeChar);
      
      if (agent) {
        // Run ReAct loop for this character reacting to the previous turn's dialog
        const response = await agent.runCognitiveLoop(lastReply, {
          systemTick: this.storyTick,
          activePeerId,
          isDebateTurn: true,
          debateTurnIndex: turn,
          llmProvider
        });

        debateLogs.push({
          sender: activeChar,
          text: response.reply_text,
          emotion: response.emotion_state,
          gifQuery: response.gif_search_query,
          tool_executed: response.tool_executed,
          tool_log: response.tool_log,
          updated_relationship_state: response.updated_relationship_state,
          thinking: response.thinking
        });

        lastReply = response.reply_text;
      }
    }

    return debateLogs;
  }

  private spawnRandomEvent(): StoryEvent {
    const events: StoryEvent[] = [
      {
        type: 'DEA_SWEEP',
        description: 'DEA initiates high-alert sweep across Albuquerque. Suspicion increases +2 globally!'
      },
      {
        type: 'PRECURSOR_SEIZURE',
        description: 'Methylamine chemical supplier shipment seized by border patrol. Walter and Jesse cook outputs reduced, pressure rises!'
      },
      {
        type: 'LOCKDOWN',
        description: 'Gus Fring goes into high safehouse lockdown mode. Security sweeps active, global threat level rises!'
      }
    ];
    return events[Math.floor(Math.random() * events.length)];
  }

  private applyEventGlobalSideEffects(event: StoryEvent) {
    for (const agent of this.activeAgents.values()) {
      const wm = agent.loadWorkingMemory();
      if (!wm.environment_alerts) wm.environment_alerts = [];
      wm.environment_alerts.push(`${event.type}: ${event.description}`);
      
      // Update peer dossiers based on event deltas
      const dossiers = agent.loadAllDossiers();
      dossiers.forEach(d => {
        const nextState = { ...d.relationship_state };
        if (event.type === 'DEA_SWEEP') {
          nextState.suspicion = Math.min(5, nextState.suspicion + 2);
          nextState.pressure = Math.min(5, nextState.pressure + 1);
        } else if (event.type === 'PRECURSOR_SEIZURE') {
          nextState.pressure = Math.min(5, nextState.pressure + 2);
        } else if (event.type === 'LOCKDOWN') {
          nextState.threat = Math.min(5, nextState.threat + 2);
          nextState.suspicion = Math.min(5, nextState.suspicion + 1);
        }
        d.relationship_state = nextState;
        agent.savePeerDossier(d.peer_id, d);
      });

      agent.saveWorkingMemory(wm);
    }
  }
}
