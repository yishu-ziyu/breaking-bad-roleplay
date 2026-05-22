import fs from 'node:fs'
import path from 'node:path'
import { AgentContainer } from './AgentContainer'
import type {
  AgentRuntimeRequest,
  AgentRuntimeResponse,
  CharacterId,
  DirectorPlan,
  RelationshipState,
  StoryEvent,
} from './types'

const characterIds: CharacterId[] = ['walter', 'jesse', 'skyler', 'saul', 'mike', 'gus']

type WorldState = {
  tick: number
  last_event: string | null
  updated_at: string
}

function clampStateValue(value: number) {
  return Math.max(-5, Math.min(5, value))
}

function applyDelta(state: RelationshipState, delta: Partial<RelationshipState>): RelationshipState {
  return {
    trust: clampStateValue(state.trust + (delta.trust ?? 0)),
    suspicion: clampStateValue(state.suspicion + (delta.suspicion ?? 0)),
    pressure: clampStateValue(state.pressure + (delta.pressure ?? 0)),
    closeness: clampStateValue(state.closeness + (delta.closeness ?? 0)),
    threat: clampStateValue(state.threat + (delta.threat ?? 0)),
  }
}

function isCharacterId(value: string): value is CharacterId {
  return characterIds.includes(value as CharacterId)
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

export class DirectorAgent {
  private readonly memoryRoot = path.join(process.cwd(), 'server', 'agents', 'memory')
  private readonly worldFile = path.join(this.memoryRoot, 'world_state.json')
  private readonly apiKey?: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey
    fs.mkdirSync(this.memoryRoot, { recursive: true })
  }

  async runAgentTurn(request: AgentRuntimeRequest): Promise<AgentRuntimeResponse> {
    const storyEvent = this.advanceClockTick(request.mode)
    const directorPlan = this.planSpeakers(request, storyEvent)
    const relationshipStates = { ...request.relationshipStates }
    const agentMessages = []
    let debateHistory = request.history

    for (const speaker of directorPlan.speakers) {
      const agent = new AgentContainer(speaker, this.apiKey)
      const message = await agent.runCognitiveLoop({
        userText: request.userText,
        relation: speaker === request.characterId ? request.relation : request.language === 'zh' ? '同场的人' : 'person in the room',
        mode: request.mode,
        language: request.language,
        history: debateHistory,
        relationshipState: relationshipStates[speaker],
        sceneGoal: directorPlan.scene_goal,
        tensionNote: directorPlan.tension_note,
      })
      relationshipStates[speaker] = applyDelta(relationshipStates[speaker], message.memory_delta)
      agentMessages.push(message)
      debateHistory = [...debateHistory, { sender: speaker, text: message.reply_text, emotion: message.emotion_state }]
    }

    if (storyEvent.global_pressure_delta > 0) {
      for (const characterId of storyEvent.affected_characters) {
        relationshipStates[characterId] = applyDelta(relationshipStates[characterId], {
          pressure: storyEvent.global_pressure_delta,
          suspicion: storyEvent.global_pressure_delta > 1 ? 1 : 0,
        })
      }
    }

    return {
      agent_messages: agentMessages,
      director_plan: directorPlan,
      relationship_states: relationshipStates,
      story_event: storyEvent,
    }
  }

  advanceClockTick(mode: 'direct' | 'crew'): StoryEvent {
    const current = readJsonFile<WorldState>(this.worldFile, {
      tick: 0,
      last_event: null,
      updated_at: new Date().toISOString(),
    })
    const tick = current.tick + 1
    const event = this.eventForTick(tick, mode)
    const nextState: WorldState = {
      tick,
      last_event: event.event_banner,
      updated_at: new Date().toISOString(),
    }
    fs.writeFileSync(this.worldFile, `${JSON.stringify(nextState, null, 2)}\n`)
    return event
  }

  private eventForTick(tick: number, mode: 'direct' | 'crew'): StoryEvent {
    if (tick % 6 === 0) {
      return {
        tick,
        event_banner: 'DEA pressure rises across Albuquerque.',
        global_pressure_delta: 2,
        affected_characters: characterIds,
      }
    }
    if (tick % 4 === 0) {
      return {
        tick,
        event_banner: mode === 'crew' ? 'A background dispute pulls more characters into the room.' : 'A quiet rumor changes the pressure in the room.',
        global_pressure_delta: 1,
        affected_characters: ['walter', 'jesse', 'saul'],
      }
    }
    return {
      tick,
      event_banner: null,
      global_pressure_delta: 0,
      affected_characters: [],
    }
  }

  private planSpeakers(request: AgentRuntimeRequest, storyEvent: StoryEvent): DirectorPlan {
    if (request.mode === 'direct') {
      return {
        speakers: [request.characterId],
        scene_goal: 'Answer through the selected relationship while updating memory.',
        tension_note: storyEvent.event_banner ?? 'Private scene; no background debate required.',
      }
    }

    const requestedCrew = request.crewParticipantIds?.filter(isCharacterId) ?? characterIds
    const allowedSpeakers = Array.from(new Set([request.characterId, ...requestedCrew])).filter(isCharacterId)
    const normalized = request.userText.toLowerCase()
    const mentioned = allowedSpeakers.filter((id) => {
      return normalized.includes(id) || normalized.includes(this.displayName(id).toLowerCase())
    })
    const pressureRank = [...allowedSpeakers].sort(
      (left, right) => request.relationshipStates[right].pressure - request.relationshipStates[left].pressure,
    )
    const speakers = Array.from(new Set([request.characterId, ...mentioned, ...pressureRank])).slice(
      0,
      Math.min(3, allowedSpeakers.length),
    )
    return {
      speakers,
      scene_goal: storyEvent.event_banner ? `Respond to the event: ${storyEvent.event_banner}` : 'Let the most pressured characters debate the user move.',
      tension_note: 'Crew mode uses the user-selected roster before director speaker planning.',
    }
  }

  private displayName(characterId: CharacterId) {
    return characterId === 'jesse'
      ? 'Jesse'
      : characterId === 'skyler'
        ? 'Skyler'
        : characterId === 'saul'
          ? 'Saul'
          : characterId === 'mike'
            ? 'Mike'
            : characterId === 'gus'
              ? 'Gus'
              : 'Walter'
  }
}
