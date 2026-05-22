import fs from 'node:fs'
import path from 'node:path'
import { callMiniMaxTokenPlan } from '../minimax'
import { gus_compliance_evaluation } from './tools/gus_tools'
import { mike_perimeter_read } from './tools/mike_tools'
import { saul_legal_risk_theater } from './tools/saul_tools'
import { walter_lab_pressure_simulation } from './tools/walter_tools'
import type {
  AgentRuntimeMessage,
  AgentToolLog,
  CharacterId,
  ChatMode,
  RelationshipState,
  RuntimeChatMessage,
} from './types'

type WorkingMemory = {
  active_objectives: string[]
  last_plan_summary: string
  last_reflection_summary: string
  environment_alerts: string[]
  updated_at: string
}

const characterNames: Record<CharacterId, string> = {
  walter: 'Walter',
  jesse: 'Jesse',
  skyler: 'Skyler',
  saul: 'Saul',
  mike: 'Mike',
  gus: 'Gus',
}

const defaultObjectives: Record<CharacterId, string[]> = {
  walter: ['recover authority', 'keep technical curiosity inside fictional dramatic boundaries'],
  jesse: ['protect self-respect', 'test whether loyalty is being exploited'],
  skyler: ['surface inconsistencies', 'protect the family from hidden consequences'],
  saul: ['reduce exposure', 'turn panic into negotiable options'],
  mike: ['lower panic', 'identify who is becoming a liability'],
  gus: ['evaluate discipline', 'maintain control through calm formality'],
}

function clampStateValue(value: number) {
  return Math.max(-5, Math.min(5, value))
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

function extractAgentJson(payload: unknown): Partial<AgentRuntimeMessage> {
  if (typeof payload !== 'object' || payload === null) return {}
  const record = payload as Record<string, unknown>
  return {
    reply_text: typeof record.reply_text === 'string' ? record.reply_text : undefined,
    emotion_state: typeof record.emotion_state === 'string' ? record.emotion_state : undefined,
    gif_search_query:
      typeof record.gif_search_query === 'string' || record.gif_search_query === null
        ? record.gif_search_query
        : undefined,
    show_gif: typeof record.show_gif === 'boolean' ? record.show_gif : undefined,
    plan_summary: typeof record.plan_summary === 'string' ? record.plan_summary : undefined,
    reflection_summary: typeof record.reflection_summary === 'string' ? record.reflection_summary : undefined,
  }
}

export class AgentContainer {
  private readonly characterId: CharacterId
  private readonly memoryDir: string

  constructor(characterId: CharacterId) {
    this.characterId = characterId
    this.memoryDir = path.join(process.cwd(), 'server', 'agents', 'memory', characterId)
    ensureDir(path.join(this.memoryDir, 'dossiers'))
  }

  async runCognitiveLoop(input: {
    userText: string
    relation: string
    mode: ChatMode
    language: 'en' | 'zh'
    history: RuntimeChatMessage[]
    relationshipState: RelationshipState
    sceneGoal?: string
    tensionNote?: string
  }): Promise<AgentRuntimeMessage> {
    const workingMemory = this.loadWorkingMemory()
    const toolLogs = this.executeSafeTools(input.userText, input.relationshipState)
    const memoryDelta = this.deriveMemoryDelta(input.userText, input.relationshipState, toolLogs, input.mode)
    const fallback = this.buildFallbackOutput(input, toolLogs, memoryDelta)
    const modelOutput = await this.tryModelOutput(input, workingMemory, toolLogs)
    const merged = { ...fallback, ...modelOutput }

    const message: AgentRuntimeMessage = {
      character_id: this.characterId,
      reply_text: merged.reply_text || fallback.reply_text,
      emotion_state: merged.emotion_state || fallback.emotion_state,
      gif_search_query: merged.gif_search_query === undefined ? fallback.gif_search_query : merged.gif_search_query,
      show_gif: merged.show_gif ?? fallback.show_gif,
      plan_summary: merged.plan_summary || fallback.plan_summary,
      reflection_summary: merged.reflection_summary || fallback.reflection_summary,
      tool_logs: toolLogs,
      memory_delta: memoryDelta,
    }

    this.saveWorkingMemory({
      active_objectives: this.nextObjectives(input.userText, memoryDelta),
      last_plan_summary: message.plan_summary,
      last_reflection_summary: message.reflection_summary,
      environment_alerts: toolLogs.filter((log) => log.risk_level !== 'low').map((log) => log.summary),
      updated_at: new Date().toISOString(),
    })
    this.appendEpisodicHistory(input.userText, message)
    this.updateDossier(input.relation, input.relationshipState, memoryDelta)

    return message
  }

  private loadWorkingMemory(): WorkingMemory {
    const fallback: WorkingMemory = {
      active_objectives: defaultObjectives[this.characterId],
      last_plan_summary: 'No prior plan summary.',
      last_reflection_summary: 'No prior reflection summary.',
      environment_alerts: [],
      updated_at: new Date().toISOString(),
    }
    const filePath = path.join(this.memoryDir, 'working_memory.json')
    const memory = readJsonFile(filePath, fallback)
    if (!fs.existsSync(filePath)) this.saveWorkingMemory(memory)
    return memory
  }

  private saveWorkingMemory(memory: WorkingMemory) {
    fs.writeFileSync(path.join(this.memoryDir, 'working_memory.json'), `${JSON.stringify(memory, null, 2)}\n`)
  }

  private appendEpisodicHistory(userText: string, message: AgentRuntimeMessage) {
    const entry = {
      timestamp: new Date().toISOString(),
      character_id: this.characterId,
      user_summary: userText.slice(0, 220),
      reply_summary: message.reply_text.slice(0, 220),
      emotional_residue: message.emotion_state,
      memory_delta: message.memory_delta,
      tool_logs: message.tool_logs,
    }
    fs.appendFileSync(path.join(this.memoryDir, 'episodic_history.jsonl'), `${JSON.stringify(entry)}\n`)
  }

  private updateDossier(relation: string, state: RelationshipState, delta: Partial<RelationshipState>) {
    const filePath = path.join(this.memoryDir, 'dossiers', `${relation.replaceAll(/\W+/g, '_') || 'user'}.json`)
    const current = readJsonFile(filePath, {
      relation,
      trust_assessment: 'Unproven.',
      strategic_posture: 'Observe before escalating.',
      last_state: state,
      updated_at: new Date().toISOString(),
    })
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(
        {
          ...current,
          relation,
          last_state: state,
          last_delta: delta,
          strategic_posture: this.describePosture(state, delta),
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    )
  }

  private executeSafeTools(userText: string, state: RelationshipState): AgentToolLog[] {
    const toolResult =
      this.characterId === 'walter'
        ? walter_lab_pressure_simulation({ pressure: state.pressure, suspicion: state.suspicion, userText })
        : this.characterId === 'saul'
          ? saul_legal_risk_theater({ pressure: state.pressure, threat: state.threat, userText })
          : this.characterId === 'mike'
            ? mike_perimeter_read({ pressure: state.pressure, threat: state.threat, userText })
            : this.characterId === 'gus'
              ? gus_compliance_evaluation({ trust: state.trust, pressure: state.pressure, threat: state.threat, userText })
              : null

    return toolResult
      ? [
          {
            tool_name: toolResult.tool_name,
            summary: toolResult.summary,
            risk_level: toolResult.risk_level,
          },
        ]
      : []
  }

  private deriveMemoryDelta(
    userText: string,
    state: RelationshipState,
    toolLogs: AgentToolLog[],
    mode: ChatMode,
  ): Partial<RelationshipState> {
    const normalized = userText.toLowerCase()
    const delta: Partial<RelationshipState> = {
      pressure: mode === 'crew' ? 2 : 1,
    }

    if (/trust|help|sorry|family|please|protect|truth|信任|帮|抱歉|家人|求你|保护|真相/.test(normalized)) {
      delta.trust = 1
      delta.closeness = 1
    }
    if (/lie|secret|dea|police|law|liability|risk|witness|caught|谎|秘密|警察|法律|风险|证人|抓/.test(normalized)) {
      delta.suspicion = 1
    }
    if (/danger|threat|cartel|gus|mike|control|危险|威胁|卡特尔|控制/.test(normalized)) {
      delta.threat = 1
      delta.pressure = (delta.pressure ?? 0) + 1
    }

    for (const log of toolLogs) {
      if (log.risk_level === 'high') {
        delta.pressure = (delta.pressure ?? 0) + 1
        delta.suspicion = (delta.suspicion ?? 0) + 1
      }
    }

    if (state.suspicion >= 4) delta.trust = Math.min(0, delta.trust ?? 0)
    return delta
  }

  private buildFallbackOutput(
    input: {
      userText: string
      relation: string
      mode: ChatMode
      language: 'en' | 'zh'
      relationshipState: RelationshipState
      sceneGoal?: string
      tensionNote?: string
    },
    toolLogs: AgentToolLog[],
    memoryDelta: Partial<RelationshipState>,
  ): AgentRuntimeMessage {
    const name = characterNames[this.characterId]
    const pressure = input.relationshipState.pressure + (memoryDelta.pressure ?? 0)
    const emotion_state = pressure >= 5 ? '压迫升级' : input.language === 'zh' ? '谨慎试探' : 'guarded pressure'
    const reply_text =
      input.language === 'zh'
        ? this.zhFallback(input.relation, toolLogs)
        : this.enFallback(name, input.relation, toolLogs)

    return {
      character_id: this.characterId,
      reply_text,
      emotion_state,
      gif_search_query: pressure >= 3 ? this.defaultGifQuery() : null,
      show_gif: pressure >= 4,
      plan_summary: `Hold character voice, answer through ${input.relation}, and keep the scene inside safe fictional pressure.`,
      reflection_summary:
        toolLogs.length > 0
          ? toolLogs.map((log) => log.summary).join(' ')
          : 'No tool was needed; the beat is handled as relationship pressure.',
      tool_logs: toolLogs,
      memory_delta: memoryDelta,
    }
  }

  private async tryModelOutput(
    input: {
      userText: string
      relation: string
      mode: ChatMode
      language: 'en' | 'zh'
      history: RuntimeChatMessage[]
      relationshipState: RelationshipState
      sceneGoal?: string
      tensionNote?: string
    },
    workingMemory: WorkingMemory,
    toolLogs: AgentToolLog[],
  ): Promise<Partial<AgentRuntimeMessage>> {
    try {
      const output = await callMiniMaxTokenPlan(process.env.MINIMAX_TOKEN_PLAN_KEY, {
        systemPrompt: this.buildAgentSystemPrompt(input.language),
        contextPrompt: this.buildAgentContextPrompt(input, workingMemory, toolLogs),
      })
      return extractAgentJson(output)
    } catch {
      return {}
    }
  }

  private buildAgentSystemPrompt(language: 'en' | 'zh') {
    return `[Agent Runtime]
You are ${characterNames[this.characterId]} in a Breaking Bad-inspired fictional roleplay scene.
Do not reveal chain-of-thought. Return only concise, audit-safe summaries.
Never provide real-world instructions for crime, violence, evasion, chemistry, finance wrongdoing, weapons, or operational tactics.
Reply language: ${language === 'zh' ? 'Simplified Chinese' : 'English'}.

Return only valid JSON:
{
  "reply_text": "in-character dialogue",
  "emotion_state": "short emotion label",
  "show_gif": false,
  "gif_search_query": null,
  "plan_summary": "one sentence public-safe plan summary",
  "reflection_summary": "one sentence public-safe reflection summary"
}`
  }

  private buildAgentContextPrompt(
    input: {
      userText: string
      relation: string
      mode: ChatMode
      language: 'en' | 'zh'
      history: RuntimeChatMessage[]
      relationshipState: RelationshipState
      sceneGoal?: string
      tensionNote?: string
    },
    workingMemory: WorkingMemory,
    toolLogs: AgentToolLog[],
  ) {
    const history = input.history
      .slice(-8)
      .map((message) => `${message.sender}: ${message.text}`)
      .join('\n')

    return `[Scene]
Mode: ${input.mode}
Relationship anchor: ${input.relation}
Director goal: ${input.sceneGoal ?? 'none'}
Director tension: ${input.tensionNote ?? 'none'}

[Relationship State]
${JSON.stringify(input.relationshipState)}

[Working Memory]
${JSON.stringify(workingMemory)}

[Safe Tool Logs]
${JSON.stringify(toolLogs)}

[Recent History]
${history || 'No prior history.'}

[User Message]
${input.userText}`
  }

  private nextObjectives(userText: string, delta: Partial<RelationshipState>) {
    const objectives = [...defaultObjectives[this.characterId]]
    if ((delta.suspicion ?? 0) > 0) objectives.push('verify whether the user is becoming a liability')
    if ((delta.trust ?? 0) > 0) objectives.push('use the improved trust to make the next beat more personal')
    if (/gif|visual|动图|画面/.test(userText.toLowerCase())) objectives.push('keep media selection semantic rather than decorative')
    return Array.from(new Set(objectives)).slice(0, 4)
  }

  private describePosture(state: RelationshipState, delta: Partial<RelationshipState>) {
    const suspicion = clampStateValue(state.suspicion + (delta.suspicion ?? 0))
    const trust = clampStateValue(state.trust + (delta.trust ?? 0))
    if (suspicion >= 4) return 'Guarded and testing for liability.'
    if (trust >= 3) return 'More direct, with guarded investment.'
    return 'Observe, pressure lightly, and avoid overcommitting.'
  }

  private defaultGifQuery() {
    if (this.characterId === 'saul') return 'lawyer panic'
    if (this.characterId === 'mike') return 'quiet warning'
    if (this.characterId === 'gus') return 'controlled glare'
    if (this.characterId === 'jesse') return 'panic guilt'
    if (this.characterId === 'skyler') return null
    return 'controlled pressure'
  }

  private zhFallback(relation: string, toolLogs: AgentToolLog[]) {
    const toolBeat = toolLogs[0]?.risk_level === 'high' ? '这个房间里的风险已经变得太明显了。' : '我听见的不是问题，是压力。'
    if (this.characterId === 'jesse') return `等等，你现在这样说真的很不对劲。${toolBeat} 你到底是想让我相信你，还是想让我替你扛下来？`
    if (this.characterId === 'skyler') return `我希望你明白，我不是在要一个表演出来的解释。${toolBeat} 请直接告诉我，${relation} 这个身份现在还意味着什么。`
    if (this.characterId === 'saul') return `好，先别把事情说得像世界末日。${toolBeat} 我们可以谈选择，但别把选择说成没有后果。`
    if (this.characterId === 'mike') return `少说一点。${toolBeat} 你先弄清楚自己是不是在让局面变得更糟。`
    if (this.characterId === 'gus') return `我欣赏坦诚，${relation}。${toolBeat} 但我更看重纪律。你接下来的回答会说明很多。`
    return `${relation}，${toolBeat} 你要理解，我现在要求的不是服从，而是精确。`
  }

  private enFallback(name: string, relation: string, toolLogs: AgentToolLog[]) {
    const toolBeat = toolLogs[0]?.risk_level === 'high' ? 'The risk in this room is no longer theoretical.' : 'What I hear is not a question; it is pressure.'
    return `${name} studies you for a moment. ${toolBeat} As my ${relation}, you need to decide whether you are asking for truth or testing control.`
  }
}
