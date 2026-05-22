export type CharacterId = 'walter' | 'jesse' | 'skyler' | 'saul' | 'mike' | 'gus'

export type ChatMode = 'direct' | 'crew'

export type RelationshipState = {
  trust: number
  suspicion: number
  pressure: number
  closeness: number
  threat: number
}

export type RuntimeChatMessage = {
  sender: 'user' | CharacterId
  text: string
  emotion?: string
  gifQuery?: string | null
}

export type AgentRuntimeRequest = {
  agentRuntimeEnabled: true
  mode: ChatMode
  characterId: CharacterId
  relation: string
  userText: string
  language: 'en' | 'zh'
  history: RuntimeChatMessage[]
  relationshipStates: Record<CharacterId, RelationshipState>
}

export type AgentToolLog = {
  tool_name: string
  summary: string
  risk_level: 'low' | 'medium' | 'high'
}

export type AgentRuntimeMessage = {
  character_id: CharacterId
  reply_text: string
  emotion_state: string
  gif_search_query: string | null
  show_gif: boolean
  plan_summary: string
  reflection_summary: string
  tool_logs: AgentToolLog[]
  memory_delta: Partial<RelationshipState>
}

export type DirectorPlan = {
  speakers: CharacterId[]
  scene_goal: string
  tension_note: string
}

export type StoryEvent = {
  tick: number
  event_banner: string | null
  global_pressure_delta: number
  affected_characters: CharacterId[]
}

export type AgentRuntimeResponse = {
  agent_messages: AgentRuntimeMessage[]
  director_plan: DirectorPlan
  relationship_states: Record<CharacterId, RelationshipState>
  story_event: StoryEvent
}
