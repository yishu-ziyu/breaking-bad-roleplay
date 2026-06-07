import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { baselineRelationshipState } from './roleProfiles'
import type { CharacterId, RelationshipState } from './roleProfiles'
import { roleAssets } from './roleAssets'
import type { RoleGifTag } from './roleAssets'
import { pickSceneUrl } from './lib/sceneBackgrounds'
import { Silhouette } from './lib/silhouette'
import { useDebouncedPersistedState, usePersistedState } from './lib/persistedState'
import { getVoiceExample } from './lib/voiceExamples'
import './App.css'

type ChatMode = 'direct' | 'crew'
type Language = 'en' | 'zh'
type Sender = 'user' | CharacterId
type StateMetric = keyof RelationshipState
type VoiceId = '白桦' | '苏打' | '茉莉'

type Character = {
  id: CharacterId
  name: string
  color: string
  traits: string
  signatureNotes: string[]
  speakingStyle: string
  relationOptions: string[]
  opener: Record<Language, string>
}

type ChatMessage = {
  id: string
  sender: Sender
  text: string
  emotion?: string
  gifQuery?: string | null
  gifUrl?: string | null
  thinking?: string
  toolExecuted?: string | null
  toolLog?: string | null
}

type DirectorPlanOutput = {
  speakers: CharacterId[]
  scene_goal?: string
  tension_note?: string
}

interface ClientDebateLogEntry {
  sender: CharacterId
  text: string
  emotion: string
  gifQuery: string | null
  tool_executed: string | null
  tool_log: string | null
  thinking: string
}

const characters: Character[] = [
  {
    id: 'walter',
    name: 'Walter',
    color: '#d7e36f',
    traits: 'controlled, prideful, brilliant, defensive, paternal on the surface, dangerous when cornered',
    signatureNotes: ['chemistry teacher precision', 'quiet menace', 'rationalizes every decision'],
    speakingStyle: 'measured, exact, increasingly forceful, with clipped pauses and moral self-justification',
    relationOptions: ['former student', 'family member', 'lab partner', 'DEA liability', 'old colleague'],
    opener: {
      en: 'Choose your words carefully. The situation is already more delicate than you understand.',
      zh: '说话谨慎一点。这个局面已经比你理解的更微妙。',
    },
  },
  {
    id: 'jesse',
    name: 'Jesse',
    color: '#93d7ff',
    traits: 'impulsive, wounded, loyal, funny under pressure, desperate to be seen as more than a screw-up',
    signatureNotes: ['street slang', 'raw emotion', 'panicked honesty'],
    speakingStyle: 'fast, emotional, profane-adjacent without explicit profanity, swinging between bravado and vulnerability',
    relationOptions: ['partner', 'old friend', 'dealer contact', 'younger sibling figure', 'person he disappointed'],
    opener: {
      en: 'Yo, if this is another lecture, I need like five seconds to emotionally leave the room first.',
      zh: 'Yo，如果这又是一场说教，我需要五秒钟先从精神上离开这个房间。',
    },
  },
  {
    id: 'skyler',
    name: 'Skyler',
    color: '#f3d9a2',
    traits: 'sharp, protective, suspicious, strategic, exhausted by secrets, hard to intimidate',
    signatureNotes: ['domestic realism', 'financial scrutiny', 'controlled anger'],
    speakingStyle: 'clear, tense, practical, with restrained fury and a talent for seeing through evasions',
    relationOptions: ['spouse', 'family member', 'bookkeeping client', 'neighbor', 'person hiding something'],
    opener: {
      en: 'I am going to ask this once plainly, and I would appreciate a plain answer.',
      zh: '我只会直说一次，也希望你给我一个直白的答案。',
    },
  },
  {
    id: 'saul',
    name: 'Saul',
    color: '#f7ce46',
    traits: 'slick, theatrical, opportunistic, quick-thinking, cowardly when stakes become real',
    signatureNotes: ['legal salesmanship', 'flashy metaphors', 'escape hatch thinking'],
    speakingStyle: 'rapid-fire persuasion, comic deflection, backroom confidence, then sudden fear',
    relationOptions: ['client', 'witness', 'business partner', 'problem to solve', 'person with cash'],
    opener: {
      en: 'Good news: you came to the right office. Bad news: that usually means something went very wrong.',
      zh: '好消息是：你找对办公室了。坏消息是：这通常说明事情已经非常不对劲。',
    },
  },
  {
    id: 'mike',
    name: 'Mike',
    color: '#b9c0a5',
    traits: 'laconic, observant, disciplined, morally tired, protective in practical ways',
    signatureNotes: ['few words', 'operational caution', 'hard-earned patience'],
    speakingStyle: 'short, dry, direct, with no wasted motion and no tolerance for panic',
    relationOptions: ['asset', 'employer', 'person under protection', 'loose end', 'rookie'],
    opener: {
      en: 'Sit down. Talk less. Start with the part you think I do not already know.',
      zh: '坐下。少说废话。从你以为我还不知道的部分开始。',
    },
  },
  {
    id: 'gus',
    name: 'Gus',
    color: '#b2f09a',
    traits: 'polished, patient, terrifyingly controlled, strategic, courteous as a form of pressure',
    signatureNotes: ['restaurant hospitality', 'corporate calm', 'precise threat management'],
    speakingStyle: 'soft-spoken, formal, immaculate, with every sentence implying a second meaning',
    relationOptions: ['employee', 'supplier', 'rival', 'guest', 'person being evaluated'],
    opener: {
      en: 'Please, take a seat. A calm conversation prevents unfortunate misunderstandings.',
      zh: '请坐。冷静的谈话可以避免一些不幸的误会。',
    },
  },
]

const gifKeywordMap: Array<{ key: RoleGifTag; terms: string[] }> = [
  { key: 'chemistry', terms: ['chemistry', 'cook', 'lab', 'meth', 'science', 'formula', 'reaction', 'blue'] },
  { key: 'lawyer', terms: ['lawyer', 'legal', 'saul', 'court', 'deal', 'negotiate', 'contract'] },
  { key: 'money', terms: ['money', 'cash', 'debt', 'payment', 'profit', 'empire', 'stash'] },
  { key: 'panic', terms: ['panic', 'fear', 'run', 'escape', 'danger', 'caught', 'gun', 'threat'] },
  { key: 'glare', terms: ['glare', 'stare', 'silent', 'control', 'intimidation', 'suspicion', 'threat'] },
  { key: 'desert', terms: ['desert', 'rv', 'abq', 'albuquerque', 'border', 'heat', 'dust'] },
  { key: 'family', terms: ['family', 'wife', 'son', 'child', 'home', 'confession', 'guilt'] },
  { key: 'deal', terms: ['deal', 'business', 'meeting', 'restaurant', 'gus', 'mike', 'cartel'] },
  { key: 'chemistry', terms: ['classroom', 'student', 'lesson', 'teacher'] },
  { key: 'business', terms: ['business', 'empire', 'operation', 'process', 'partner', 'transaction'] },
  { key: 'restraint', terms: ['restraint', 'calm', 'controlled', 'contain', 'patience', 'composure'] },
  { key: 'confrontation', terms: ['confrontation', 'cornered', 'office', 'dark office', 'accusation'] },
  { key: 'glare', terms: ['control', 'threat', 'danger', 'intense', 'intimidation', 'stare'] },
  { key: 'tense', terms: ['tense', 'pressure', 'moral', 'secret', 'lie', 'tension'] },
]

const relationLabels: Record<string, Record<Language, string>> = {
  'former student': { en: 'former student', zh: '前学生' },
  'family member': { en: 'family member', zh: '家人' },
  'lab partner': { en: 'lab partner', zh: '实验室搭档' },
  'DEA liability': { en: 'DEA liability', zh: 'DEA 风险人物' },
  'old colleague': { en: 'old colleague', zh: '旧同事' },
  partner: { en: 'partner', zh: '搭档' },
  'old friend': { en: 'old friend', zh: '老朋友' },
  'dealer contact': { en: 'dealer contact', zh: '地下联系人' },
  'younger sibling figure': { en: 'younger sibling figure', zh: '像弟妹一样的人' },
  'person he disappointed': { en: 'person he disappointed', zh: '被他辜负的人' },
  spouse: { en: 'spouse', zh: '配偶' },
  'bookkeeping client': { en: 'bookkeeping client', zh: '记账客户' },
  neighbor: { en: 'neighbor', zh: '邻居' },
  'person hiding something': { en: 'person hiding something', zh: '有所隐瞒的人' },
  client: { en: 'client', zh: '客户' },
  witness: { en: 'witness', zh: '证人' },
  'business partner': { en: 'business partner', zh: '商业伙伴' },
  'problem to solve': { en: 'problem to solve', zh: '待处理麻烦' },
  'person with cash': { en: 'person with cash', zh: '带着现金的人' },
  asset: { en: 'asset', zh: '线人资产' },
  employer: { en: 'employer', zh: '雇主' },
  'person under protection': { en: 'person under protection', zh: '受保护对象' },
  'loose end': { en: 'loose end', zh: '未清理风险' },
  rookie: { en: 'rookie', zh: '新手' },
  employee: { en: 'employee', zh: '员工' },
  supplier: { en: 'supplier', zh: '供应方' },
  rival: { en: 'rival', zh: '对手' },
  guest: { en: 'guest', zh: '客人' },
  'person being evaluated': { en: 'person being evaluated', zh: '被评估的人' },
}

const uiText = {
  en: {
    tagline: 'Stateful Breaking Bad autonomous agents running Plan-Reflect cognitive loops.',
    character: 'Active Profile',
    language: 'Language',
    relation: 'Relationship anchor',
    mode: 'Conversation mode',
    private: 'Private Loop',
    crew: 'Crew Debate',
    modelService: 'Cognitive Engine',
    liveMiniMax: 'MiniMax-M2.7 (Stateful)',
    liveMiniMaxHint: 'Stateful ReAct loop & memories are saved locally in the server vault.',
    ttsVoice: 'TTS Voice',
    relationshipState: 'State Dossier Metrics',
    statePanel: 'State Panel',
    showState: 'Show Dossiers',
    hideState: 'Hide Dossiers',
    directorPlan: 'Director Plan',
    promptEngine: 'Cognitive Diagnostics',
    promptLayers: 'ReAct Internal Thoughts & Fictional Tools Logs',
    inspectPrompt: 'Inspect ReAct Active Thinking Log',
    privateScene: 'Private Room',
    crewScene: 'Orchestrated Stage',
    schema: 'Plan-Reflect Active',
    you: 'You',
    gifTrigger: 'GIF trigger',
    messageLabel: 'Message',
    messagePlaceholder: 'Negotiate with {character} as their {relation}...',
    sending: 'Reflecting',
    send: 'Submit Action',
  },
  zh: {
    tagline: '《绝命毒师》微观智能体引擎，后台 Plan-Reflect 认知循环与文件记忆库。',
    character: '主控角色',
    language: '语言',
    relation: '关系锚点',
    mode: '剧情模式',
    private: '微观私聊 (ReAct)',
    crew: '宏观剧情辩论 (Debate)',
    modelService: '认知计算引擎',
    liveMiniMax: 'MiniMax-M2.7 (Stateful)',
    liveMiniMaxHint: '角色 Plan-Reflect 认知模型与本地 Episodic 记忆库已就绪。',
    ttsVoice: 'TTS 音色',
    relationshipState: '记忆卷宗与关系状态',
    statePanel: '卷宗面板',
    showState: '展开卷宗',
    hideState: '收起卷宗',
    directorPlan: '宏观导演计划',
    promptEngine: '微观认知诊断 (ReAct Diagnostics)',
    promptLayers: '内部思考链路与工具化动作日志',
    inspectPrompt: '查看当前角色 ReAct 深度思考过程',
    privateScene: '私密拉扯场景',
    crewScene: '多人剧情辩论',
    schema: 'Plan-Reflect 认知循环',
    you: '你',
    gifTrigger: 'GIF 触发词',
    messageLabel: '消息',
    messagePlaceholder: '以 {relation} 的身份向 {character} 展开对话...',
    sending: '深度思考中',
    send: '发送动作',
  },
} satisfies Record<Language, Record<string, string>>

const stateLabels: Record<StateMetric, Record<Language, string>> = {
  trust: { en: 'Trust', zh: '信任' },
  suspicion: { en: 'Suspicion', zh: '怀疑' },
  pressure: { en: 'Pressure', zh: '压力' },
  closeness: { en: 'Closeness', zh: '亲密' },
  threat: { en: 'Threat', zh: '威胁' },
}

const stateMetrics = Object.keys(stateLabels) as StateMetric[]

// P0-G: TTS 音色下拉（MVP），每个角色提供 2 个可选音色，第一个为推荐默认
const voiceOptionsByChar: Record<CharacterId, Array<{ id: VoiceId; label: string }>> = {
  walter: [
    { id: '白桦', label: '沉稳男声（白桦）' },
    { id: '苏打', label: '沙哑男声（苏打）' },
  ],
  jesse: [
    { id: '苏打', label: '街头男声（苏打）' },
    { id: '白桦', label: '低沉稳重（白桦）' },
  ],
  skyler: [
    { id: '茉莉', label: '清透女声（茉莉）' },
    { id: '白桦', label: '中性克制（白桦）' },
  ],
  saul: [
    { id: '白桦', label: '戏剧推销（白桦）' },
    { id: '苏打', label: '高亢急促（苏打）' },
  ],
  mike: [
    { id: '白桦', label: '低沉稳重（白桦）' },
    { id: '茉莉', label: '冷淡女声（茉莉）' },
  ],
  gus: [
    { id: '白桦', label: '克制威压（白桦）' },
    { id: '茉莉', label: '温柔冰冷（茉莉）' },
  ],
}

function getRelationLabel(relation: string, language: Language) {
  return relationLabels[relation]?.[language] ?? relation
}

function formatRelation(character: Character, relation: string, language: Language) {
  const label = getRelationLabel(relation, language)
  return language === 'zh' ? `${character.name} 的${label}` : `${character.name}'s ${label}`
}

function getOpener(character: Character, language: Language) {
  // P0-H: 优先用模板里的 Original example 句作为开场白
  // language=zh 时优先返回中文例句，en 时如果只有中文就用中文（保持模板原始）
  const example = getVoiceExample(character.id, character.relationOptions[0])
  if (example) return example
  return character.opener[language]
}

function createInitialRelationshipStates(): Record<CharacterId, RelationshipState> {
  return characters.reduce(
    (states, character) => ({
      ...states,
      [character.id]: { ...baselineRelationshipState },
    }),
    {} as Record<CharacterId, RelationshipState>,
  )
}

function hashText(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

function pickGif(characterId: CharacterId, key: RoleGifTag, seed: string, recentGifUrls: string[] = []) {
  const pool = roleAssets[characterId].gifPools.filter((asset) => asset.tags.includes(key))
  const fallbackPool = roleAssets[characterId].gifPools.filter((asset) => asset.tags.includes('default'))
  const candidates = pool.length ? pool : fallbackPool
  if (!candidates.length) return null

  const startIndex = hashText(`${key}:${seed}`) % candidates.length
  const orderedCandidates = candidates.slice(startIndex).concat(candidates.slice(0, startIndex))
  const freshCandidate = orderedCandidates.find((asset) => !recentGifUrls.includes(asset.url))
  if (freshCandidate) return freshCandidate.url

  const rolePool = roleAssets[characterId].gifPools
  const roleStartIndex = hashText(`role:${key}:${seed}`) % rolePool.length
  const orderedRolePool = rolePool.slice(roleStartIndex).concat(rolePool.slice(0, roleStartIndex))
  const freshRoleCandidate = orderedRolePool.find((asset) => !recentGifUrls.includes(asset.url))
  return (freshRoleCandidate ?? orderedCandidates[0]).url
}

function resolveGif(
  query: string | null | undefined,
  characterId: string,
  emotionState: string | null | undefined,
  recentGifUrls: string[] = [],
  turnSeed = '',
) {
  if (!query) return null
  const normalized = `${query} ${emotionState ?? ''} ${characterId}`.toLowerCase()
  const safeCharacterId = characters.some((character) => character.id === characterId) ? (characterId as CharacterId) : 'walter'
  const key =
    gifKeywordMap.find(({ terms }) => terms.some((term) => normalized.includes(term)))?.key ??
    gifKeywordMap[hashText(normalized) % gifKeywordMap.length].key

  return pickGif(safeCharacterId, key, `${normalized}:${turnSeed}`, recentGifUrls)
}

function App() {
  const [selectedCharacterId, setSelectedCharacterId] = usePersistedState<CharacterId>('character', 'walter')
  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? characters[0]
  const [language, setLanguage] = usePersistedState<Language>('language', 'zh')
  const t = uiText[language]
  // P0-E: relation 按角色持久化，切换角色不丢
  const [relationByChar, setRelationByChar] = usePersistedState<Record<string, string>>('relation', {})
  const relation = relationByChar[selectedCharacterId] ?? selectedCharacter.relationOptions[0]
  const [mode, setMode] = usePersistedState<ChatMode>('mode', 'direct')
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Game states driven entirely by backend API responses
  const [storyTick, setStoryTick] = useState<number>(0)
  const [activeEvent, setActiveEvent] = useState<{ type: string; description: string } | null>(null)
  // P0-E: 关系状态 debounce 500ms 写入
  const [relationshipStates, setRelationshipStates] = useDebouncedPersistedState<Record<CharacterId, RelationshipState>>(
    'relationships',
    createInitialRelationshipStates(),
    500,
  )
  const [thinkingLog, setThinkingLog] = useState<string>('Observe user inputs, planning step details...')
  const [toolLog, setToolLog] = useState<string>('No characters tools invoked yet.')

  const [isStatePanelOpen, setIsStatePanelOpen] = usePersistedState<boolean>('statePanelOpen', true)
  const [lastDirectorPlan, setLastDirectorPlan] = useState<DirectorPlanOutput | null>(null)
  // P0-E: 每个角色独立的 messages 历史，含 LLM conversation history 全文
  const [messagesByChar, setMessagesByChar] = usePersistedState<Record<string, ChatMessage[]>>('messages', {})
  const messages = messagesByChar[selectedCharacterId] ?? []

  const [ttsLoadingMap, setTtsLoadingMap] = useState<Record<string, boolean>>({})
  const [llmProvider, setLlmProvider] = usePersistedState<string>('llmProvider', 'mimo')
  // P0-G: TTS 音色按角色持久化
  const [voiceByChar, setVoiceByChar] = usePersistedState<Record<string, VoiceId>>('ttsVoice', {})
  const currentVoice = voiceByChar[selectedCharacterId] ?? voiceOptionsByChar[selectedCharacterId][0].id

  // P0-E: 首次进入某角色时写入 opener
  useEffect(() => {
    if (!messagesByChar[selectedCharacterId]) {
      setMessagesByChar((prev) => ({
        ...prev,
        [selectedCharacterId]: [
          {
            id: `opener-${selectedCharacterId}`,
            sender: selectedCharacterId,
            text: getOpener(selectedCharacter, language),
            emotion: language === 'zh' ? '开场压迫' : 'opening pressure',
            gifQuery: null,
            gifUrl: null,
          },
        ],
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCharacterId, language])

  // P0-E: messagesByChar 的便捷更新器
  const updateMessages = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessagesByChar((prev) => ({
      ...prev,
      [selectedCharacterId]: updater(prev[selectedCharacterId] ?? []),
    }))
  }

  // P0-B: 根据最近 8 条消息关键词切换场景背景
  const sceneStyle = useMemo<CSSProperties>(() => {
    const recentTexts = messages.slice(-8).map((m) => m.text)
    const url = pickSceneUrl(recentTexts)
    return {
      backgroundImage: `linear-gradient(180deg, var(--scene-overlay-tint) 0%, var(--scene-overlay-tint-2) 100%), url(${url})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    }
  }, [messages])

  const handlePlayTts = async (msgId: string, charId: string, text: string, emotion?: string, voice?: VoiceId) => {
    if (ttsLoadingMap[msgId]) return
    setTtsLoadingMap((prev) => ({ ...prev, [msgId]: true }))
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: charId, text, emotion, voiceId: voice }),
      })
      if (!response.ok) {
        const detail = await response.json()
        throw new Error(detail.error || 'Speech synthesis failed')
      }
      const data = await response.json()
      if (data.audioData) {
        const audio = new Audio('data:audio/wav;base64,' + data.audioData)
        await audio.play()
      } else {
        throw new Error('No audio data returned')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTtsLoadingMap((prev) => ({ ...prev, [msgId]: false }))
    }
  }

  // Advanced Timeline Tick Trigger
  const handleClockTick = async () => {
    setIsSending(true)
    setError(null)
    try {
      const response = await fetch('/api/game-loop', { method: 'POST' })
      if (!response.ok) throw new Error('Game clock tick request failed.')
      const data = await response.json()
      
      setStoryTick(data.story_tick)
      if (data.spawned_event) {
        setActiveEvent(data.spawned_event)
        // Flash overlay then set auto disappear or dismissable
      } else {
        setActiveEvent(null)
      }

      // Synchronize states globally from memory
      if (data.global_relationship_states) {
        const nextStates = { ...relationshipStates }
        Object.keys(data.global_relationship_states).forEach(charId => {
          const charDossiers = data.global_relationship_states[charId]
          // Summarize relational averages or look from active character perspective
          const viewFromTarget = charDossiers['jesse'] || baselineRelationshipState
          nextStates[charId as CharacterId] = viewFromTarget
        })
        setRelationshipStates(nextStates)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsSending(false)
    }
  }

  const handleCharacterChange = (id: CharacterId) => {
    const nextCharacter = characters.find((character) => character.id === id) ?? selectedCharacter
    setSelectedCharacterId(id)
    setRelationByChar((prev) => ({
      ...prev,
      [id]: nextCharacter.relationOptions[0],
    }))
    // P0-E: 不再清空 messages — 切换角色保留各自历史；useEffect 会给新角色写入 opener
    setLastDirectorPlan(null)
    setThinkingLog("Observe user inputs, planning step details...")
    setToolLog("No characters tools invoked yet.")
  }

  const handleLanguageChange = (nextLanguage: Language) => {
    // P0-E: 仅切换语言标签，不动 messages 历史
    setLanguage(nextLanguage)
    setMessage('')
    setError(null)
    setLastDirectorPlan(null)
  }

  const handleSend = async (event: FormEvent) => {
    event.preventDefault()
    const userText = message.trim()
    if (!userText || isSending) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: userText,
    }
    const nextHistory = [...messages, userMessage]
    updateMessages(() => nextHistory)
    setMessage('')
    setIsSending(true)
    setError(null)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: selectedCharacter.id,
          userInput: userText,
          relation,
          mode,
          history: nextHistory.slice(-10).map(m => ({ sender: m.sender, text: m.text })),
          language,
          llmProvider,
          voiceExample: getVoiceExample(selectedCharacter.id, relation) ?? null,
        })
      })

      if (!response.ok) {
        const detail = await response.json()
        throw new Error(detail.error || 'Server-side MiniMax ReAct loop failed.')
      }

      const data = await response.json()

      if (mode === 'crew') {
        // Multi-Agent Debate Loop Handoff
        setLastDirectorPlan({
          speakers: data.participants || ['walter', 'jesse'], // dynamic list from API response
          scene_goal: data.scene_goal,
          tension_note: data.tension_note
        })

        const debateReplies: ChatMessage[] = []
        if (data.debate_logs && Array.isArray(data.debate_logs)) {
          data.debate_logs.forEach((log: ClientDebateLogEntry, idx: number) => {
            const recentCharacterGifUrls = [...nextHistory, ...debateReplies]
              .filter((cm) => cm.sender === log.sender && cm.gifUrl)
              .slice(-3)
              .map((cm) => cm.gifUrl as string)

            debateReplies.push({
              id: crypto.randomUUID(),
              sender: log.sender,
              text: log.text,
              emotion: log.emotion,
              gifQuery: log.gifQuery,
              gifUrl: resolveGif(
                log.gifQuery,
                log.sender,
                log.emotion,
                recentCharacterGifUrls,
                `${nextHistory.length}:${idx}:${userText}`
              ),
              thinking: log.thinking,
              toolExecuted: log.tool_executed,
              toolLog: log.tool_log
            })
          })

          // Save cognitive diagnostic details from final debate speaker
          const finalLog = data.debate_logs[data.debate_logs.length - 1]
          if (finalLog) {
            setThinkingLog(finalLog.thinking || "Observe debate sequence completed.")
            setToolLog(finalLog.tool_log || "No character tools executed in final debate turn.")
          }
        }
        updateMessages((current) => [...current, ...debateReplies])
      } else {
        // Direct Stateful ReAct Turn
        const recentCharacterGifUrls = nextHistory
          .filter((cm) => cm.sender === selectedCharacter.id && cm.gifUrl)
          .slice(-3)
          .map((cm) => cm.gifUrl as string)

        const agentReply: ChatMessage = {
          id: crypto.randomUUID(),
          sender: selectedCharacter.id,
          text: data.reply_text,
          emotion: data.emotion_state,
          gifQuery: data.gif_search_query,
          gifUrl: resolveGif(
            data.gif_search_query,
            selectedCharacter.id,
            data.emotion_state,
            recentCharacterGifUrls,
            `${nextHistory.length}:${userText}`
          ),
          thinking: data.thinking,
          toolExecuted: data.tool_executed,
          toolLog: data.tool_log
        }

        // Render dynamic diagnostics
        setThinkingLog(data.thinking || "Cognitive loop completed successfully.")
        setToolLog(data.tool_log || "No character tools executed this turn.")
        
        // Sync dossiers
        if (data.updated_relationship_state) {
          setRelationshipStates(current => ({
            ...current,
            [selectedCharacter.id]: data.updated_relationship_state
          }))
        }

        updateMessages((current) => [...current, agentReply])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <main className="app-shell">
      {activeEvent && (
        <div className="macro-event-overlay" role="alert">
          <div className="event-content">
            <span className="event-badge">CRITICAL INCIDENT REPORT</span>
            <h3>{activeEvent.type}</h3>
            <p>{activeEvent.description}</p>
            <button className="dismiss-btn" onClick={() => setActiveEvent(null)}>Acknowledged</button>
          </div>
        </div>
      )}

      <aside className="control-panel">
        <div className="brand-lockup">
          <span className="frame-dot" />
          <h1>ABQ Roleplay Lab</h1>
          <p>{t.tagline}</p>
        </div>

        {/* Stateful Story Clock Widget */}
        <section className="panel-section game-clock-widget">
          <header className="widget-header">
            <span className="widget-title">STORY TIMELINE CLOCK</span>
            <span className="tick-badge">TICK: #{storyTick}</span>
          </header>
          <div className="clock-actions">
            <button 
              className="tick-btn" 
              type="button" 
              onClick={handleClockTick} 
              disabled={isSending}
            >
              {isSending ? "Advancing Tick..." : "Advance Story Clock (+1 Tick)"}
            </button>
          </div>
          <p className="widget-hint">Advancing the story timeline clock evaluates global character dossiers and triggers random cartel or DEA sweeps.</p>
        </section>

        <section className="panel-section">
          <h2>{t.character}</h2>
          <div className="character-grid" role="list">
            {characters.map((character) => (
              <button
                className={character.id === selectedCharacter.id ? 'character-card selected' : 'character-card'}
                key={character.id}
                onClick={() => handleCharacterChange(character.id)}
                style={{ '--character-color': character.color } as CSSProperties}
                type="button"
              >
                <Silhouette characterId={character.id} name={character.name} size={32} />
                <strong>{character.name}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="panel-section">
          <span className="field-label">{t.language}</span>
          <div className="segmented-control" aria-label={t.language}>
            <button className={language === 'en' ? 'active' : ''} type="button" onClick={() => handleLanguageChange('en')}>
              EN
            </button>
            <button className={language === 'zh' ? 'active' : ''} type="button" onClick={() => handleLanguageChange('zh')}>
              中文
            </button>
          </div>
        </section>

        <section className="panel-section">
          <label htmlFor="relation">{t.relation}</label>
          <select id="relation" value={relation} onChange={(event) => setRelationByChar((prev) => ({ ...prev, [selectedCharacterId]: event.target.value }))}>
            {selectedCharacter.relationOptions.map((option) => (
              <option key={option} value={option}>
                {formatRelation(selectedCharacter, option, language)}
              </option>
            ))}
          </select>
        </section>

        <section className="panel-section">
          <span className="field-label">{t.mode}</span>
          <div className="segmented-control" aria-label={t.mode}>
            <button className={mode === 'direct' ? 'active' : ''} type="button" onClick={() => setMode('direct')}>
              {t.private}
            </button>
            <button className={mode === 'crew' ? 'active' : ''} type="button" onClick={() => setMode('crew')}>
              {t.crew}
            </button>
          </div>
        </section>

        <section className="panel-section">
          <label htmlFor="llmProvider">LLM Backend Provider / 模型后端</label>
          <select id="llmProvider" value={llmProvider} onChange={(event) => setLlmProvider(event.target.value)}>
            <option value="mimo">Xiaomi MiMo (Token Plan)</option>
            <option value="minimax">MiniMax (Proxy)</option>
          </select>
        </section>

        {/* P0-G: TTS 音色选择（MVP） */}
        <section className="panel-section">
          <label htmlFor="ttsVoice">{t.ttsVoice}</label>
          <select
            id="ttsVoice"
            value={currentVoice}
            onChange={(event) =>
              setVoiceByChar((prev) => ({ ...prev, [selectedCharacterId]: event.target.value as VoiceId }))
            }
          >
            {voiceOptionsByChar[selectedCharacterId].map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </section>

        <section className="panel-section">
          <div className="section-heading-row">
            <span className="field-label">{t.relationshipState}</span>
            <button className="panel-toggle" type="button" onClick={() => setIsStatePanelOpen((isOpen) => !isOpen)}>
              {isStatePanelOpen ? t.hideState : t.showState}
            </button>
          </div>
          {isStatePanelOpen && (
            <div className="state-panel" aria-label={t.statePanel}>
              {characters.map((character) => (
                <div className="state-card" key={character.id}>
                  <header>
                    <span
                      className="state-avatar"
                      style={{ '--character-color': character.color } as CSSProperties}
                    >
                      <Silhouette characterId={character.id} name={character.name} size={24} />
                    </span>
                    <strong>{character.name}</strong>
                  </header>
                  <div className="state-metrics">
                    {stateMetrics.map((metric) => {
                      const value = relationshipStates[character.id][metric]
                      return (
                        <div className="state-meter" key={metric}>
                          <span>{stateLabels[metric][language]}</span>
                          <div aria-label={`${stateLabels[metric][language]} ${value}`}>
                            <i style={{ inlineSize: `${((value + 5) / 10) * 100}%` }} />
                          </div>
                          <b>{value >= 0 ? `+${value}` : value}</b>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Premium Mini-Agent ReAct Diagnostics Panel */}
        <section className="prompt-engine react-diagnostics-widget">
          <div>
            <h2>{t.promptEngine}</h2>
            <span>{t.promptLayers}</span>
          </div>
          <div className="diagnostics-card">
            <details open>
              <summary>Plan-Reflect Cognitive Loop</summary>
              <pre className="thinking-text">{thinkingLog}</pre>
            </details>
            <details open>
              <summary>Executable Character Action Tool Log</summary>
              <pre className="tool-text">{toolLog}</pre>
            </details>
          </div>
        </section>
      </aside>

      <section className="chat-panel" style={sceneStyle}>
        <header className="chat-header">
          <div>
            <p>{mode === 'crew' ? t.crewScene : t.privateScene}</p>
            <h2>
              {language === 'zh'
                ? `${selectedCharacter.name} 与其${getRelationLabel(relation, language)}`
                : `${selectedCharacter.name} with their ${getRelationLabel(relation, language)}`}
            </h2>
            {mode === 'crew' && lastDirectorPlan && (
              <span className="director-note">
                {t.directorPlan}: {lastDirectorPlan.scene_goal || lastDirectorPlan.tension_note || lastDirectorPlan.speakers.join(', ')}
              </span>
            )}
          </div>
          <div className="schema-pill">{t.schema}</div>
        </header>

        <div className="chat-stream" aria-live="polite">
          {messages.map((chatMessage) => {
            const senderCharacter =
              chatMessage.sender === 'user' ? null : characters.find((character) => character.id === chatMessage.sender)
            return (
              <article className={chatMessage.sender === 'user' ? 'message user-message' : 'message character-message'} key={chatMessage.id}>
                <div
                  className="avatar"
                  style={{ '--character-color': senderCharacter?.color ?? 'var(--color-bb-yellow)' } as CSSProperties}
                >
                  {chatMessage.sender === 'user' ? (
                    <span className="avatar-letter">{t.you.toString().slice(0, 1)}</span>
                  ) : senderCharacter ? (
                    <Silhouette
                      characterId={chatMessage.sender}
                      name={senderCharacter.name}
                      size={40}
                    />
                  ) : null}
                </div>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>
                      {chatMessage.sender === 'user'
                        ? `${t.you}, ${formatRelation(selectedCharacter, relation, language)}`
                        : senderCharacter?.name}
                    </strong>
                    {chatMessage.emotion && <span>{chatMessage.emotion}</span>}
                    {chatMessage.sender !== 'user' && (
                      <button
                        className="tts-btn"
                        onClick={() =>
                          handlePlayTts(
                            chatMessage.id,
                            chatMessage.sender,
                            chatMessage.text,
                            chatMessage.emotion,
                            currentVoice,
                          )
                        }
                        disabled={ttsLoadingMap[chatMessage.id]}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: '8px', fontSize: '1em', padding: 0 }}
                        title="Play Speech"
                      >
                        {ttsLoadingMap[chatMessage.id] ? '⏳' : '🔊'}
                      </button>
                    )}
                  </div>
                  <p>{chatMessage.text}</p>
                  
                  {/* Tool execution notifications inside bubbles */}
                  {chatMessage.toolExecuted && (
                    <div className="tool-executed-pill" title={chatMessage.toolLog || ""}>
                      <span>🛠️ Tool Triggered: <code>{chatMessage.toolExecuted}</code></span>
                      <p>{chatMessage.toolLog}</p>
                    </div>
                  )}

                  {chatMessage.gifUrl && (
                    <figure className="gif-card" data-query={chatMessage.gifQuery ?? 'crime-drama reaction'}>
                      <img
                        src={chatMessage.gifUrl}
                        alt={chatMessage.gifQuery ?? 'crime-drama reaction GIF'}
                        onError={(event) => {
                          event.currentTarget.closest('figure')?.setAttribute('hidden', 'true')
                        }}
                      />
                      <figcaption>
                        {t.gifTrigger}: {chatMessage.gifQuery}
                      </figcaption>
                    </figure>
                  )}
                </div>
              </article>
            )
          })}
        </div>

        {isSending && (
          <div className="typing-indicator" aria-live="polite" aria-label={t.sending}>
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}

        {error && <div className="error-box">{error}</div>}

        <form className="composer" onSubmit={handleSend}>
          <input
            aria-label={t.messageLabel}
            placeholder={t.messagePlaceholder
              .replace('{character}', selectedCharacter.name)
              .replace('{relation}', getRelationLabel(relation, language))}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <button type="submit" disabled={isSending || !message.trim()}>
            {isSending ? t.sending : t.send}
          </button>
        </form>
      </section>
    </main>
  )
}

export default App
