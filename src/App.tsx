import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Silhouette } from './lib/silhouette'
import { usePersistedState } from './lib/persistedState'
import { getVoiceExample } from './lib/voiceExamples'
import { useStoryStream, type StoryEvent } from './hooks/useStoryStream'
import { useCharacterMemory, type CharacterMemory } from './hooks/useCharacterMemory'
import { useAuth } from './hooks/useAuth'
import {
  loadChatMessages,
  loadCharacterMemory,
  persistPrivateCharacterMemory,
  persistPrivateChatMessage,
  persistPrivateChatMessages,
} from './lib/supabasePersistence'
import { loadStoredPrivacyKey, PRIVACY_KEY_UPDATED_EVENT } from './lib/privacyVault'
import { AuthSection } from './components/AuthSection'
import { GifCard } from './components/GifCard'
import { PlotGraphPanel } from './components/PlotGraphPanel'
import { AgentHarnessPanel } from './components/AgentHarnessPanel'
import { ColdOpenLanding, type ColdOpenStartPayload, type KnowledgeTrack } from './components/ColdOpenLanding'
import {
  DramaDecisionBar,
  dramaSuggestionsForBeat,
  type DramaSuggestion,
} from './components/DramaDecisionBar'
import { VoicePlayer } from './components/VoicePlayer'
import { ConnectionChip, ConnectionSheet } from './components/ConnectionSheet'
import { useConnection } from './hooks/useConnection'
import { useQuota, parseQuotaError } from './hooks/useQuota'
import { authHeaders } from './lib/authHeaders'
import { pickSceneUrl } from './lib/sceneBackgrounds'
import { resolveGifUrl } from './lib/gifResolver'
import {
  STAGE_DWELL_MS,
  listStageCardIndices,
} from './lib/storyStagePacing'
import './App.css'

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type ChatMode = 'direct' | 'crew'
type Language = 'en' | 'zh'
type View = 'chat' | 'story'
/** Unified player surface: story / solo chat / crew debate (P2). */
type Surface = 'story' | 'direct' | 'crew'

type CharacterId = 'walter' | 'jesse' | 'skyler' | 'saul' | 'mike' | 'gus' | 'hank' | 'marie'

const DISPLAY_NAME_TO_ID: Record<string, CharacterId> = {
  'Walter White': 'walter', 'Walter': 'walter',
  'Jesse Pinkman': 'jesse', 'Jesse': 'jesse',
  'Skyler White': 'skyler', 'Skyler': 'skyler',
  'Saul Goodman': 'saul', 'Saul': 'saul',
  'Mike Ehrmantraut': 'mike', 'Mike': 'mike',
  'Gus Fring': 'gus', 'Gus': 'gus',
  'Hank Schrader': 'hank', 'Hank': 'hank',
  'Marie Schrader': 'marie', 'Marie': 'marie',
}

const STORY_CARD_EVENT_TYPES = new Set(['scene_change', 'agent_speak', 'agent_think', 'agent_act'])

function resolveStoryEventGif(evt: StoryEvent): string | null {
  if (evt.type !== 'agent_speak') return null
  if (evt.data.show_gif === false) return null
  if (!evt.data.gif_search_query && !evt.data.emotion_state) return null
  const charId = DISPLAY_NAME_TO_ID[evt.data.character_id as string]
  if (!charId) return null
  return resolveGifUrl(
    charId,
    (evt.data.emotion_state as string) ?? null,
    (evt.data.gif_search_query as string) ?? null,
  )
}

const STORY_EVENT_GIF_CACHE = new WeakMap<StoryEvent, string | null>()

function getStoryEventGif(evt: StoryEvent): string | null {
  const cached = STORY_EVENT_GIF_CACHE.get(evt)
  if (cached !== undefined) return cached
  const resolved = resolveStoryEventGif(evt)
  STORY_EVENT_GIF_CACHE.set(evt, resolved)
  return resolved
}

/** Type chip only (说 / 内心 / 行动 / …) - no character name. */
function getEventTypeChip(evt: StoryEvent, lang: Language): string {
  const t = uiText[lang]
  switch (evt.type) {
    case 'outline': return t.eventOutline
    case 'scene_change': return t.eventSceneChange
    case 'agent_speak': return t.eventSpeaks
    case 'agent_think': return t.eventThinks
    case 'agent_act': return t.eventActs
    case 'beat_ready': return t.eventBeatReady
    case 'world_state_delta': return t.eventWorldDelta
    case 'status': return t.eventStatus
    case 'complete': return t.eventComplete
    case 'error': return t.eventError
    default: return evt.type
  }
}

function getEventTitle(evt: StoryEvent, lang: Language): string {
  const charId = (evt.data.character_id as string) ?? ''
  const chip = getEventTypeChip(evt, lang)
  // Think / act: type chip alone on the rail (character lives on the stage).
  if (evt.type === 'agent_think' || evt.type === 'agent_act') return chip
  // Speak: character name is the primary rail label.
  if (evt.type === 'agent_speak' && charId) return charId
  return chip
}

/** Diegetic outline teaser — never print McKee craft (spine / structure / idea). */
function formatStoryPlanPreview(outline: string, lang: Language): string {
  const lines = outline
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const beats = lines.filter(line => /^\d+[.)]\s+/.test(line))
  const count = Math.max(beats.length, 1)
  if (lang === 'zh') {
    if (count <= 1) return '局面还在收紧'
    if (count <= 3) return '这一夜还有几处关口'
    return `这一夜大约还有 ${count} 处关口`
  }
  if (count <= 1) return 'The night is still tightening'
  if (count <= 3) return 'A few hard turns still ahead'
  return `About ${count} hard turns still ahead`
}

/** Hide McKee craft scaffolding if a legacy event still embeds it. */
function playerFacingSceneText(raw: string): string {
  let s = raw
    .replace(/^Transitioning to:\s*/i, '')
    .replace(/^切换至[：:]\s*/, '')
    .replace(/^\d+[.)、]\s*/, '')
    .replace(/\[(?:setup|inciting|progressive|crisis|climax|resolution)\]\s*/gi, '')
    .trim()
  // QA P1#5: strip leading craft fields ("值: 安全→隐隐不安 — 间隙: …" leaks
  // when the description starts inside the field block, so the split-at-dash
  // rule below misses it). Keep only the text after the last craft field.
  const craftField = /(?:值|gap|价值|间隙|risk|风险|value)\s*[:：]\s*([^—–]*?)(?=\s*(?:—|–|$|(?:值|gap|价值|间隙|risk|风险|value)\s*[:：]))/gi
  const matches = [...s.matchAll(craftField)]
  if (matches.length > 0) {
    const afterLast = s.slice((matches[matches.length - 1].index ?? 0) + matches[matches.length - 1][0].length)
    const tail = afterLast.replace(/^[\s—–-]+/, '').trim()
    // If anything meaningful follows the craft block keep it; else drop the
    // whole string (it was pure scaffolding).
    s = tail.length > 8 ? tail : ''
  }
  // Cut at value/gap/risk craft fields (em/en dash or hyphen variants).
  s = s.split(/\s*[—–\-]\s*(?:value|gap|risk)\s*[:：]/i)[0]?.trim() ?? s
  // QA P1#5: stage-direction tech marks leaking into scene cards (〔turn_to → Walter〕).
  s = s.replace(/〔\s*turn_to\s*→\s*[^〕]*〕/gi, '').replace(/\[\s*turn_to\s*→\s*[^\]]*\]/gi, '')
  return s.replace(/\s+/g, ' ').replace(/^[\s\-—–]+|[\s\-—–]+$/g, '')
}

function getStoryEventSummary(evt: StoryEvent, lang: Language): string {
  switch (evt.type) {
    case 'scene_change':
      return playerFacingSceneText((evt.data.description as string) ?? '')
    case 'agent_speak':
      return (evt.data.content as string) ?? ''
    case 'agent_think':
      return (evt.data.thought_content as string) ?? ''
    case 'agent_act': {
      // Stage-direction form: 〔靠向椅背〕
      const action = ((evt.data.action as string) ?? '').trim()
      if (!action) return ''
      const bare = action.replace(/^[〔[]/, '').replace(/[〕\]]$/, '')
      return `〔${bare}〕`
    }
    case 'world_state_delta': {
      const deltas = evt.data.deltas as Array<Record<string, string>> | undefined
      if (!deltas?.length) return lang === 'zh' ? '后果正在变化。' : 'Consequences are shifting.'
      const rendered = deltas.map(d => {
        const hasContent = d.target || d.entity || d.field || d.old_value || d.new_value
        if (!hasContent) return null
        const entity = d.target ?? d.entity ?? ''
        if (!entity && !d.field) return null
        return `${entity}: ${d.field} ${d.old_value ?? '∅'} → ${d.new_value ?? '∅'}`
      }).filter(Boolean)
      return rendered.length > 0 ? rendered.join('\n') : (lang === 'zh' ? '后果正在变化。' : 'Consequences are shifting.')
    }
    case 'status':
    case 'complete':
    case 'error':
      return translateBackendMessage(evt.data.message as string, lang)
    default:
      return ''
  }
}

/* P1-3: translate known backend-emitted English status strings */
const BACKEND_STATUS_TRANSLATIONS: Record<string, Record<Language, string>> = {
  'Director is analysing the task...': {
    en: 'Director is analysing the task...',
    zh: '局面正在成形…',
  },
  'Director outlined {n} beat(s). Beginning roleplay…': {
    en: 'Director outlined {n} beat(s). Beginning roleplay…',
    zh: '{n} 段压力要来了。线头动了…',
  },
  'No action received - continuing automatically.': {
    en: 'No action received - continuing automatically.',
    zh: '未收到玩家操作 - 自动继续…',
  },
  'All beats rendered. Roleplay outline complete.': {
    en: 'All beats rendered. Roleplay outline complete.',
    zh: '所有场面已落下。这一夜先到这里。',
  },
}

function translateBackendMessage(msg: string, lang: Language): string {
  if (lang === 'en' || !msg) return msg
  for (const [key, translations] of Object.entries(BACKEND_STATUS_TRANSLATIONS)) {
    if (msg === key) return translations.zh
    /* Handle the beat count variant */
    if (key.includes('{n}') && msg.startsWith('Director outlined ')) {
      const match = msg.match(/Director outlined (\d+) beat\(s\)\. Beginning roleplay…/)
      if (match) {
        return translations.zh.replace('{n}', match[1])
      }
    }
  }
  return msg
}

/** Map director emotion_state tags for HUD display (tags stay English for GIFs). */
const EMOTION_LABELS: Record<string, Record<Language, string>> = {
  calm: { en: 'calm', zh: '平静' },
  tense: { en: 'tense', zh: '紧张' },
  angry: { en: 'angry', zh: '愤怒' },
  fearful: { en: 'fearful', zh: '恐惧' },
  manipulative: { en: 'manipulative', zh: '操控' },
  guilty: { en: 'guilty', zh: '内疚' },
  resigned: { en: 'resigned', zh: '无奈' },
  desperate: { en: 'desperate', zh: '绝望' },
  opening: { en: 'opening pressure', zh: '开场压迫' },
}

function formatEmotionLabel(raw: string | null | undefined, lang: Language): string {
  if (!raw) return ''
  const key = raw.trim().toLowerCase()
  return EMOTION_LABELS[key]?.[lang] ?? raw
}

/** Sanitize emotion_state for CSS class hooks (alphanumeric + hyphen only). */
function emotionStageClass(raw: string | null | undefined): string | null {
  if (!raw) return null
  const safe = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return safe || null
}

function truncateText(text: string, maxLen: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLen) return cleaned
  return `${cleaned.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** True while an IME candidate window is open — Enter confirms the candidate, not submit. */
function isImeComposing(e: ReactKeyboardEvent<HTMLElement>): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229
}

function getStoryEventTimelineSummary(evt: StoryEvent, lang: Language, maxLen = 52): string {
  const full = getStoryEventSummary(evt, lang)
  // Act: keep one short stage-direction line on the rail.
  if (evt.type === 'agent_act') return truncateText(full, Math.min(maxLen, 28))
  // Delta: ultra-short consequence note.
  if (evt.type === 'world_state_delta') return truncateText(full, Math.min(maxLen, 36))
  return truncateText(full, maxLen)
}

function getStoryCardHeading(evt: StoryEvent | null, fallback: string): string {
  if (!evt) return fallback
  const characterId = typeof evt.data.character_id === 'string' ? evt.data.character_id : ''
  if (characterId) return characterId
  return fallback
}

function findLastStoryEvent(
  events: StoryEvent[],
  predicate: (evt: StoryEvent) => boolean,
): StoryEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const evt = events[i]
    if (evt && predicate(evt)) return evt
  }
  return null
}

type ChatMessage = {
  id: string
  sender: CharacterId | 'user'
  text: string
  emotion?: string
  gifQuery?: string | null
  gifUrl?: string | null
  thinking?: string
  toolExecuted?: string | null
  toolLog?: string | null
}

type Character = {
  id: CharacterId
  name: string
  color: string
  oneLiner: Record<Language, string>
  relationOptions: string[]
  opener: Record<Language, string>
}

/* ------------------------------------------------------------------ */
/*  Static data                                                       */
/* ------------------------------------------------------------------ */

const characters: Character[] = [
  {
    id: 'walter', name: 'Walter', color: '#d7e36f',
    oneLiner: { en: 'A chemistry teacher turned empire builder. Precision, pride, and terrible secrets.', zh: '化学老师转型帝国建造者。精确、骄傲，和见不得人的秘密。' },
    relationOptions: ['former student', 'family member', 'lab partner', 'DEA liability', 'old colleague'],
    opener: { en: 'Choose your words carefully. The situation is already more delicate than you understand.', zh: '说话谨慎一点。这个局面已经比你理解的更微妙。' },
  }, {
    id: 'jesse', name: 'Jesse', color: '#93d7ff',
    oneLiner: { en: 'A cook with a conscience. Street-smart, impulsive, and desperately loyal.', zh: '有良知的制作者。街头聪明、冲动，却又极度忠诚。' },
    relationOptions: ['partner', 'old friend', 'dealer contact', 'younger sibling figure', 'person he disappointed'],
    opener: { en: 'Yo, if this is another lecture, I need like five seconds to emotionally leave the room first.', zh: 'Yo，如果这又是一场说教，我需要五秒钟先从精神上离开这个房间。' },
  }, {
    id: 'skyler', name: 'Skyler', color: '#f3d9a2',
    oneLiner: { en: 'The wife who found the cracks. Protective, sharp, and running out of patience.', zh: '发现了裂痕的妻子。护家心切、敏锐，耐心快要耗尽。' },
    relationOptions: ['spouse', 'family member', 'bookkeeping client', 'neighbor', 'person hiding something'],
    opener: { en: 'I am going to ask this once plainly, and I would appreciate a plain answer.', zh: '我只会直说一次，也希望你给我一个直白的答案。' },
  }, {
    id: 'saul', name: 'Saul', color: '#f7ce46',
    oneLiner: { en: 'A criminal lawyer who sees every problem as a business opportunity.', zh: '把每个问题都看成商机的刑事律师。' },
    relationOptions: ['client', 'witness', 'business partner', 'problem to solve', 'person with cash'],
    opener: { en: 'Good news: you came to the right office. Bad news: that usually means something went very wrong.', zh: '好消息是：你找对办公室了。坏消息是：这通常说明事情已经非常不对劲。' },
  }, {
    id: 'mike', name: 'Mike', color: '#b9c0a5',
    oneLiner: { en: 'A former cop who cleaned up after everyone. Quiet, lethal, and exhausted by incompetence.', zh: '为所有人善后的前警探。安静、致命，厌倦了愚蠢。' },
    relationOptions: ['asset', 'employer', 'person under protection', 'loose end', 'rookie'],
    opener: { en: 'Sit down. Talk less. Start with the part you think I do not already know.', zh: '坐下。少说废话。从你以为我还不知道的部分开始。' },
  }, {
    id: 'gus', name: 'Gus', color: '#b2f09a',
    oneLiner: { en: 'A restaurant owner with absolute control. Every gesture is calculated, every silence is a threat.', zh: '拥有绝对控制权的餐厅老板。每个动作都经过计算，每段沉默都是威胁。' },
    relationOptions: ['employee', 'supplier', 'rival', 'guest', 'person being evaluated'],
    opener: { en: 'Please, take a seat. A calm conversation prevents unfortunate misunderstandings.', zh: '请坐。冷静的谈话可以避免一些不幸的误会。' },
  }, {
    id: 'hank', name: 'Hank', color: '#f0a36b',
    oneLiner: {
      en: 'A loud DEA agent with a soft spot for family. Jokes first, then the questions that stick.',
      zh: '吵闹的 DEA 探员，对家人护短。先开玩笑，再问到你改口。',
    },
    relationOptions: [
      'family member',
      'DEA partner',
      'suspect under watch',
      'neighbor',
      'friend of the family',
    ],
    opener: {
      en: 'Hey, relax. I am not here to ruin your day. I am just here to notice if your story keeps changing.',
      zh: '嘿，放松。我不是来毁你一天的，我只是来看看你的故事会不会改口。',
    },
  }, {
    id: 'marie', name: 'Marie', color: '#c8b6e2',
    oneLiner: {
      en: 'Hank\u2019s wife and Skyler\u2019s sister-in-law. Polished hospitality with a sharp eye for what does not add up at home.',
      zh: 'Hank 的妻子，Skyler 的嫂子。礼貌周到，对家里说不通的地方尤其敏锐。',
    },
    relationOptions: [
      'Skyler sister-in-law',
      'Hank spouse',
      'supportive but uncomprehending',
    ],
    opener: {
      en: 'Come sit down. I made the kitchen look nice and I want to hear how your day is going.',
      zh: '坐下吧。我把厨房收拾了一下，想听听你今天过得怎么样。',
    },
  },
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
  'person he disappointed': { en: '被他辜负的人', zh: '被他辜负的人' },
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
  'person being evaluated': { en: '被评估的人', zh: '被评估的人' },
  'DEA partner': { en: 'DEA partner', zh: 'DEA 搭档' },
  'suspect under watch': { en: 'suspect under watch', zh: '被盯上的人' },
  'friend of the family': { en: 'friend of the family', zh: '家人的朋友' },
  'Skyler sister-in-law': { en: 'Skyler sister-in-law', zh: 'Skyler 的嫂子' },
  'Hank spouse': { en: 'Hank spouse', zh: 'Hank 的妻子' },
  'supportive but uncomprehending': { en: 'supportive but uncomprehending', zh: '支持却不理解的人' },
}

const uiText: Record<Language, Record<string, string>> = {
  en: {
    tagline: 'Character dossiers, pressure scenes, and consequence-driven roleplay.',
    character: 'Active Profile',
    language: 'Language',
    relation: 'Relation',
    view: 'View',
    story: 'Story',
    direct: 'Direct Chat',
    crew: 'Crew Debate',
    model: 'Model engine',
    storyTitle: 'ABQ Roleplay Lab',
    setStage: 'Set the Stage',
    setStageHint: 'Describe the story you want in natural language. The scene board will play it beat by beat, pausing at pressure points for your decision.',
    placeholder: 'e.g. Walter White needs to secure a new methylamine supply from Gus Fring without Skyler finding out…',
    startStory: 'Start Story',
    narrativeStream: 'This night',
    eventFeed: 'Fine-grained event-driven narrative',
    directorDecision: 'Choose the next move:',
    switchToChat: 'Chat · no chapter advance',
    you: 'You',
    send: 'Send',
    sending: 'Thinking…',
    messagePlaceholder: 'Negotiate with {character} as their {relation}…',
    privateScene: 'Private Scene',
    crewScene: 'Crew Debate',
    schema: 'On scene',
    gifTrigger: 'Scene beat',
    connected: 'Stream live',
    connecting: 'Half a bag of cash left in the RV. The night is not done with anyone.',
    streamingUnfold: 'The situation is still unfolding…',
    disconnected: 'Disconnected',
    storyComplete: 'Story complete. All beats rendered.',
    continue: 'Continue',
    stop: 'Stop',
    storyOutline: 'The situation',
    paused: 'Paused',
    toolLabel: 'Tool Call',
    eventOutline: 'The situation',
    eventSceneChange: 'Scene Setup',
    eventSpeaks: 'speaks',
    eventThinks: 'inner',
    eventActs: 'acts',
    eventBeatReady: 'Beat decision',
    eventWorldDelta: 'Consequences',
    eventStatus: 'Scene Status',
    eventComplete: 'Scene Wrapped',
    eventError: 'Error',
    openingEmotion: 'opening pressure',
    enterWorld: 'Chat with Walter',
    langEn: 'EN',
    beatRedirect: '↩ Redirect',
    beatSwitchPerspective: '👤 Switch Perspective',
    beatSubmit: 'Submit',
    beatCancel: 'Cancel',
    beatSelectCharacter: 'Select character…',
    beatRedirectPlaceholder: 'Enter new plot direction…',
    chatHeaderWith: '{character} with their {relation}',
    savePrompt: 'Sign in to save this conversation to the cloud.',
    langZh: '中文',
    resumingStory: 'Resuming previous story...',
    reconnect: 'Reconnect',
    restart: 'Restart',
    autoContinue: 'Scene resumes after 5min idle...',
    streaming: 'Streaming',
    returnToLanding: '↩ Return to Landing',
    continueChapter: 'Start Chapter 2',
    branchStory: 'Try a Different Branch',
    replayBeat: 'Replay Last Beat',
    startAgain: 'Start Again',
    storyCompleteHint: 'Each new beat will pick up the last chapter\'s context.',
    plotNet: 'Situation map',
    plotNetShow: 'Open situation map',
    plotNetHide: 'Close',
    plotNetLoad: 'Reading the room…',
    plotNetError: 'Could not load the map.',
    plotNetEmpty: 'Play a few beats first - the map grows from what you lived.',
    plotNetPast: 'Already lived',
    plotNetNow: 'Current situation',
    plotNetFog: 'Unknown future',
    plotNetKnown: 'You already know',
    plotNetShifting: 'Still shifting',
    plotNetCast: 'Who spoke',
    plotNetNoPast: 'This is where the thread starts.',
    plotNetNoFog: 'No open pressure yet - the next beat will write the fog.',
    plotNetHint: 'Past is fact. Present is the door. Future is fog - only this session.',
    plotNetBeats: 'beats',
    plotNetCastMeta: 'cast',
    plotNetLines: 'lines',
    plotNetNowTag: 'NOW',
    plotNetFogTag: 'FOG',
    pressureDossier: 'Relationship pressure',
    pressureTrust: 'Trust',
    pressureStyle: 'Pressure',
    pressureConflict: 'Conflict',
    scene: 'Scene',
    location: 'Location',
    tension: 'Tension',
    time: 'Time',
    sceneTimeline: 'Beats',
    unspokenPressure: 'Unspoken Pressure',
    possibleConsequences: 'Possible Consequences',
    relationshipImpact: 'Relationship Impact',
    currentBeat: 'Current Beat',
    sceneFallback: 'The scene is waiting for the first beat.',
    storyLocationFallback: 'North of ABQ',
    outlineExpand: 'Open',
    outlineCollapse: 'Close',
    timelineHint: 'Tap a beat to focus the stage',
    archiveHandle: 'Archive',
    timelineCollapse: 'Hide rail',
    timelineExpand: 'Show rail',
    gifToggleHide: 'Hide GIF',
    gifToggleShow: 'Show GIF',
    stopGenerating: 'Stop',
    newMessages: 'New messages',
    stagePrev: 'Previous card',
    stageNext: 'Next card',
    backToLive: 'Back to latest',
    storyStartHint: 'Tip: press ⌘/Ctrl+Enter to start',
  },
  zh: {
    tagline: '进入阿尔伯克基的角色档案、压力现场与随选择改写的剧情。',
    character: '角色档案',
    language: '语言',
    relation: '身份关系',
    view: '游玩模式',
    story: '剧情',
    direct: '单人场景',
    crew: '群像会谈',
    model: '模型引擎',
    storyTitle: 'ABQ Roleplay Lab',
    setStage: '开场设定',
    setStageHint: '用自然语言写下你想压进这一夜的冲突。场面会一段段推，到紧要处停下来等你。',
    placeholder: '例如：Walter White 需要想办法从 Gus Fring 那里拿到新的甲胺供应，同时不能让 Skyler 发现…',
    startStory: '进入这一夜',
    narrativeStream: '这一夜',
    eventFeed: '实时剧情事件',
    directorDecision: '关键节点：选择下一步',
    switchToChat: '单聊·不推进章节',
    you: '你',
    send: '发送',
    sending: '生成回应…',
    messagePlaceholder: '以{relation}身份对 {character} 说…',
    privateScene: '单人场景',
    crewScene: '群像会谈',
    schema: '现场',
    gifTrigger: '镜头节点',
    connected: '现场已连接',
    connecting: '房车里还剩半袋现金。夜还没放过任何人。',
    streamingUnfold: '局面还在展开…',
    disconnected: '已断开',
    storyComplete: '这一夜告一段落。',
    continue: '继续',
    stop: '停止',
    storyOutline: '局面',
    paused: '已暂停',
    toolLabel: '工具调用',
    eventOutline: '局面',
    eventSceneChange: '场景建立',
    eventSpeaks: '说',
    eventThinks: '内心',
    eventActs: '行动',
    eventBeatReady: '关键选择',
    eventWorldDelta: '后果',
    eventStatus: '现场状态',
    eventComplete: '收场',
    eventError: '错误',
    reconnect: '重连',
    restart: '重新开始',
    autoContinue: '5 分钟无操作，现场自动继续中…',
    streaming: '播放中',
    resumingStory: '正在恢复上次剧情…',
    openingEmotion: '开场压迫',
    langZh: '中文',
    enterWorld: '和 Walter 聊聊',
    langEn: 'EN',
    beatRedirect: '↩ 重定向',
    beatSwitchPerspective: '👤 切换视角',
    beatSubmit: '提交',
    beatCancel: '取消',
    beatSelectCharacter: '选择角色…',
    beatRedirectPlaceholder: '输入新的剧情方向…',
    chatHeaderWith: '{character} 与{relation}',
    savePrompt: '同步档案后，可在云端保存这段会谈。',
    returnToLanding: '↩ 回到主页',
    continueChapter: '开始第二章',
    branchStory: '换一个分支重开',
    replayBeat: '重演最后节点',
    startAgain: '重新开始',
    storyCompleteHint: '下一节会用上一章的剧情作为起点。',
    plotNet: '局面地图',
    plotNetShow: '打开局面地图',
    plotNetHide: '关闭',
    plotNetLoad: '正在读场…',
    plotNetError: '地图加载失败。',
    plotNetEmpty: '先多玩几拍，地图会从你经历的内容长出来。',
    plotNetPast: '已经历',
    plotNetNow: '当前局面',
    plotNetFog: '未知未来',
    plotNetKnown: '你已知道',
    plotNetShifting: '正在变化',
    plotNetCast: '谁开过口',
    plotNetNoPast: '这就是线头开始的地方。',
    plotNetNoFog: '还没有未解压力，下一拍会写出迷雾。',
    plotNetHint: '过去是图，现在是门，未来是雾。只来自本局。',
    plotNetBeats: '节拍',
    plotNetCastMeta: '角色',
    plotNetLines: '台词',
    plotNetNowTag: '此刻',
    plotNetFogTag: '迷雾',
    pressureDossier: '关系压力',
    pressureTrust: '信任',
    pressureStyle: '施压方式',
    pressureConflict: '冲突钩子',
    scene: '场次',
    location: '地点',
    tension: '张力',
    time: '时间',
    sceneTimeline: '分镜',
    unspokenPressure: '未说出口的压力',
    possibleConsequences: '可能后果',
    relationshipImpact: '关系影响',
    currentBeat: '当前节点',
    sceneFallback: '现场还在等第一拍。',
    storyLocationFallback: '阿尔伯克基北部',
    outlineExpand: '展开',
    outlineCollapse: '收起',
    timelineHint: '点选分镜，主舞台切换',
    archiveHandle: '档案',
    timelineCollapse: '收起分镜',
    timelineExpand: '展开分镜',
    gifToggleHide: '关 GIF',
    gifToggleShow: '开 GIF',
    stopGenerating: '停止',
    newMessages: '新消息',
    stagePrev: '上一张',
    stageNext: '下一张',
    backToLive: '回到最新',
    storyStartHint: '提示：按 ⌘/Ctrl+Enter 快速开始',
  },
}


/* ------------------------------------------------------------------ */
function getRelationLabel(relation: string, lang: Language): string {
  return relationLabels[relation]?.[lang] ?? relation
}

function formatRelation(char: Character, relation: string, lang: Language): string {
  const label = getRelationLabel(relation, lang)
  return lang === 'zh' ? `${char.name} 的${label}` : `${char.name}'s ${label}`
}

/*  BeatControls - decision UI at beat_ready                          */
/* ------------------------------------------------------------------ */

type BeatAction = 'continue' | 'stop' | 'redirect' | 'switch_perspective'

interface BeatControlsProps {
  t: Record<string, string>
  characters: Character[]
  onContinue: () => void | Promise<void>
  onStop: () => void | Promise<void>
  onRedirect: (prompt: string) => void | Promise<void>
  onSwitchPerspective: (charId: string) => void | Promise<void>
}

function BeatControls({ t, characters, onContinue, onStop, onRedirect, onSwitchPerspective }: BeatControlsProps) {
  const [pending, setPending] = useState<BeatAction | null>(null)
  const [redirectOpen, setRedirectOpen] = useState(false)
  const [redirectText, setRedirectText] = useState('')
  const [perspectiveOpen, setPerspectiveOpen] = useState(false)

  const wrap = (action: BeatAction, fn: () => void | Promise<void>) => async () => {
    if (pending) return
    setPending(action)
    try {
      await fn()
    } finally {
      setPending(null)
    }
  }

  const labels = {
    redirect: t.beatRedirect,
    switchPerspective: t.beatSwitchPerspective,
    submit: t.beatSubmit,
    cancel: t.beatCancel,
    selectCharacter: t.beatSelectCharacter,
    redirectPlaceholder: t.beatRedirectPlaceholder,
  }

  return (
    <div className="beat-controls">
      <button onClick={wrap('continue', onContinue)} disabled={pending !== null}>
        {pending === 'continue' ? '...' : `▶ ${t.continue}`}
      </button>
      <button onClick={wrap('stop', onStop)} disabled={pending !== null}>
        {pending === 'stop' ? '...' : `⏹ ${t.stop}`}
      </button>
      {!redirectOpen && (
        <button onClick={() => setRedirectOpen(true)} disabled={pending !== null}>{labels.redirect}</button>
      )}
      {redirectOpen && (
        <form
          className="redirect-control"
          onSubmit={(e) => {
            e.preventDefault()
            if (!redirectText.trim() || pending) return
            void wrap('redirect', () => {
              const p = redirectText
              setRedirectOpen(false)
              setRedirectText('')
              return onRedirect(p)
            })()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRedirectOpen(false)
          }}
        >
          <input
            autoFocus
            value={redirectText}
            onChange={e => setRedirectText(e.target.value)}
            onKeyDown={(e) => {
              // IME guard: Enter that confirms a candidate must not submit the redirect.
              if (e.key === 'Enter' && isImeComposing(e)) e.preventDefault()
            }}
            placeholder={labels.redirectPlaceholder}
            disabled={pending !== null}
          />
          <button
            type="submit"
            disabled={pending !== null || !redirectText.trim()}
          >
            {labels.submit}
          </button>
          <button type="button" onClick={() => setRedirectOpen(false)} disabled={pending !== null}>{labels.cancel}</button>
        </form>
      )}
      {!perspectiveOpen && (
        <button onClick={() => setPerspectiveOpen(true)} disabled={pending !== null}>{labels.switchPerspective}</button>
      )}
      {perspectiveOpen && (
        <div
          className="perspective-control"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPerspectiveOpen(false)
          }}
        >
          <select
            value=""
            onChange={e => {
              if (e.target.value) {
                wrap('switch_perspective', () => {
                  const v = e.target.value
                  setPerspectiveOpen(false)
                  return onSwitchPerspective(v)
                })()
              }
            }}
            disabled={pending !== null}
          >
            <option value="">{labels.selectCharacter}</option>
            {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={() => setPerspectiveOpen(false)} disabled={pending !== null}>{labels.cancel}</button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ErrorBox - dismissable inline error                               */
/* ------------------------------------------------------------------ */

function ErrorBox({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span className="error-box__text">{message}</span>
      <button type="button" className="error-box__dismiss" onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  )
}

const DEFAULT_STORY_PROMPT_EN =
  "Gus Fring sits across from Walter White in the Los Pollos Hermanos office. The air is still. Gus studies Walt with calm precision. Walt's pride wars with his fear. Jesse is waiting in the parking lot, not knowing this meeting could change everything."
const DEFAULT_STORY_PROMPT_ZH =
  "古斯·弗林格与沃尔特·怀特对坐在洛斯波罗斯·赫尔曼诺斯餐厅办公室。空气凝固。古斯冷静审视沃尔特。沃尔特的自尊与恐惧交战。杰西在停车场等候，不知道这次会面可能改变一切。"
function defaultStoryPrompt(lang: Language): string {
  return lang === 'zh' ? DEFAULT_STORY_PROMPT_ZH : DEFAULT_STORY_PROMPT_EN
}

/* ------------------------------------------------------------------ */
/*  Product surface migration (D06 / P07 FOUC)                         */
/*  Must run BEFORE usePersistedState hydrates enteredWorld/view so   */
/*  the first commit is already cold-open for pre-v2 localStorage.    */
/* ------------------------------------------------------------------ */

const PRODUCT_SURFACE = 'v2-cold-open' as const
const LS_PREFIX = 'abq_'

function readLs<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLs(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
  } catch {
    /* silent — same policy as usePersistedState */
  }
}

/** Sync one-shot: write migrated keys before React state reads them. */
function migrateProductSurfaceBeforePaint(): void {
  const surface = readLs<string | null>('productSurface', null)
  if (surface === PRODUCT_SURFACE) return
  writeLs('enteredWorld', false)
  writeLs('view', 'story')
  writeLs('productSurface', PRODUCT_SURFACE)
}

/** P2: merge legacy view(chat/story) + mode(direct/crew) into one surface key.
 *  Idempotent — only writes when the surface key is absent. Keeps old keys
 *  intact so a downgrade does not lose the user's last choice. */
function migrateSurfaceBeforePaint(): void {
  if (typeof window === 'undefined') return
  const existing = readLs<string | null>('surface', null)
  if (existing !== null) return
  const legacyView = readLs<string | null>('view', 'story')
  const legacyMode = readLs<string | null>('mode', 'direct')
  let next: Surface = 'story'
  if (legacyView === 'chat') {
    next = legacyMode === 'crew' ? 'crew' : 'direct'
  }
  writeLs('surface', next)
}

/* ------------------------------------------------------------------ */
/*  App                                                               */
/* ------------------------------------------------------------------ */

function App() {
  // Pre-paint migration: first frame must already be cold open for pre-v2 LS.
  migrateProductSurfaceBeforePaint()
  // P2: merge legacy view+mode into surface before React hydrates it.
  migrateSurfaceBeforePaint()

  // Language: use browser preference on first visit, then persist
  const defaultLanguage: Language = navigator.language.startsWith('zh') ? 'zh' : 'en'
  const [storedLanguage, setLanguage] = usePersistedState<Language | null>('language', null)
  const language: Language = storedLanguage ?? defaultLanguage
  const t = uiText[language]

  const [selectedCharId, setSelectedCharId] = usePersistedState<CharacterId>('character', 'walter')
  const selectedChar = characters.find(c => c.id === selectedCharId) ?? characters[0]

  // After migrateProductSurfaceBeforePaint, pre-v2 LS already has enteredWorld=false.
  const [hasEnteredWorld, setHasEnteredWorld] = usePersistedState<boolean>('enteredWorld', false)
  /* Playbook F1/C1: knowledge track doubles as the onboarding-done flag (one tap);
     drama coach mark is one-shot. */
  const [knowledgeTrack, setKnowledgeTrack] = usePersistedState<KnowledgeTrack | null>(
    'knowledgeTrack',
    null,
  )
  const [dramaHintSeen, setDramaHintSeen] = usePersistedState<boolean>('dramaHintSeen', false)

  // P0-4: when switching to a character that already has a saved relation,
  // surface a brief inline notice so the user understands the relation
  // was kept (instead of silently defaulting back to the first option).
  const [relationNotice, setRelationNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!relationNotice) return
    const id = window.setTimeout(() => setRelationNotice(null), 3500)
    return () => window.clearTimeout(id)
  }, [relationNotice])

  // Relation per character (persist across character switches)
  const [relationByChar, setRelationByChar] = usePersistedState<Record<string, string>>('relation', {})
  const relation = relationByChar[selectedCharId] ?? selectedChar.relationOptions[0]

  // P2: one player surface (story / solo / crew). view & mode are derived for
  // the rest of the component, so rendering logic needs no other changes.
  const [surface, setSurface] = usePersistedState<Surface>('surface', 'story')
  const view: View = surface === 'story' ? 'story' : 'chat'
  const mode: ChatMode = surface === 'crew' ? 'crew' : 'direct'

  const [productSurface, setProductSurface] = usePersistedState<string | null>('productSurface', null)

  // Safety net only: mid-session surface clear / race. First paint is handled above.
  useEffect(() => {
    if (productSurface === PRODUCT_SURFACE) return
    queueMicrotask(() => {
      setHasEnteredWorld(false)
      setSurface('story')
      setProductSurface(PRODUCT_SURFACE)
    })
  }, [productSurface, setHasEnteredWorld, setSurface, setProductSurface])
  const connection = useConnection()
  const auth = useAuth()
  const quota = useQuota(connection.connectionSessionId, auth.user?.id ?? null)
  /** Agent harness is lab-only (?lab=1 or /lab) — not part of the drama surface. */
  const showAgentLab = useMemo(() => {
    if (typeof window === 'undefined') return false
    try {
      const sp = new URLSearchParams(window.location.search)
      if (sp.get('lab') === '1') return true
      return window.location.pathname.includes('/lab')
    } catch {
      return false
    }
  }, [])

  // Chat state
  const [messagesByChar, setMessagesByChar] = usePersistedState<Record<string, ChatMessage[]>>('messages', {})
  const messages = useMemo(() => messagesByChar[selectedCharId] ?? [], [messagesByChar, selectedCharId])
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Composer textarea: auto-grow + focus target after send / view switch. */
  const composerRef = useRef<HTMLTextAreaElement>(null)
  /** In-flight /api/chat request; aborted by the stop button. */
  const chatAbortRef = useRef<AbortController | null>(null)
  /** Chat stream: only auto-scroll when the reader is already near the bottom. */
  const [chatPinnedToBottom, setChatPinnedToBottom] = useState(true)
  const [unseenBelow, setUnseenBelow] = useState(false)
  /** Story board: outline collapsed by default to free stage space. */
  const [outlineExpanded, setOutlineExpanded] = useState(false)
  /** null = auto-follow latest card event; number = user pinned a timeline row. */
  const [pinnedStoryEventIndex, setPinnedStoryEventIndex] = useState<number | null>(null)
  /** Position within stage-card indices (not raw event index). */
  const [stageCardPos, setStageCardPos] = useState(0)
  const stageShownAtRef = useRef<number | null>(null)
  /** Beat rail closed by default — stage + dialogue + decision first. */
  const [timelineRailOpen, setTimelineRailOpen] = useState(false)
  /** GIF off by default — film stills / stage text, not meme GIFs. */
  const [storyGifHidden, setStoryGifHidden] = useState(true)
  /** Free-text line for DramaDecisionBar (beat pause). */
  const [decisionFree, setDecisionFree] = useState('')
  /** Cold-open choice id so first-beat chips match the crisis the player picked. */
  const [coldOpenChoiceId, setColdOpenChoiceId] = useState<string | null>(null)
  /** Situation map is opt-in only - never auto-pop on complete. */
  const [plotMapOpen, setPlotMapOpen] = useState(false)

  // Auth state (useAuth called above for quota tier)
  const [cloudPrivacy, setCloudPrivacy] = useState<{
    status: 'guest' | 'loading' | 'ready' | 'locked'
    key: CryptoKey | null
  }>({ status: 'guest', key: null })

  useEffect(() => {
    let cancelled = false
    const userId = auth.user?.id

    const setCloudPrivacyAsync = (next: typeof cloudPrivacy) => {
      queueMicrotask(() => {
        if (!cancelled) setCloudPrivacy(next)
      })
    }

    const loadPrivacyKey = () => {
      if (!userId) {
        setCloudPrivacyAsync({ status: 'guest', key: null })
        return
      }

      setCloudPrivacyAsync({ status: 'loading', key: null })
      loadStoredPrivacyKey(userId)
        .then(key => {
          if (cancelled) return
          setCloudPrivacy(key ? { status: 'ready', key } : { status: 'locked', key: null })
        })
        .catch(() => {
          if (cancelled) return
          setCloudPrivacy({ status: 'locked', key: null })
        })
    }

    if (!auth.user) {
      loadPrivacyKey()
      return () => { cancelled = true }
    }

    const handlePrivacyKeyUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail
      if (detail?.userId === userId) loadPrivacyKey()
    }

    loadPrivacyKey()
    window.addEventListener(PRIVACY_KEY_UPDATED_EVENT, handlePrivacyKeyUpdated)

    return () => {
      cancelled = true
      window.removeEventListener(PRIVACY_KEY_UPDATED_EVENT, handlePrivacyKeyUpdated)
    }
  }, [auth.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Story state
  const story = useStoryStream()
  const [storyTask, setStoryTask] = useState('')
  /** Story setup textarea: autofocus target when the board is idle. */
  const storyTaskRef = useRef<HTMLTextAreaElement>(null)
  /** Beat rail container: keeps the active beat scrolled into view. */
  const storyEventsRef = useRef<HTMLDivElement>(null)

  // Keep story SSE bind token in sync with connection vault.
  useEffect(() => {
    story.setConnectionSessionId(connection.connectionSessionId)
  }, [connection.connectionSessionId, story])

  // Refresh free credits after each story beat pause/complete.
  useEffect(() => {
    if (
      story.connectionState === 'beat_paused'
      || story.connectionState === 'complete'
      || story.connectionState === 'error'
    ) {
      void quota.refresh()
    }
  }, [story.connectionState, quota.refresh])

  // Character memory (per character, sliding window)
  const charMemory = useCharacterMemory()
  const [memoryByChar, setMemoryByChar] = usePersistedState<Record<string, CharacterMemory>>('memory', {})
  const currentMemory = useMemo(
    () => memoryByChar[selectedCharId] ?? { summary: '', keyFacts: [] },
    [memoryByChar, selectedCharId],
  )

  // Cloud sync: persist to Supabase when authenticated
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const backfilledCloudKeysRef = useRef<Set<string>>(new Set())

  /* ---- Unified init: cloud sync (merge) + first-visit opener ----
     M2: Cloud sync MERGES cloud messages with local (dedup by sender+text)
     instead of replacing, so unsaved local messages (opener, guest-mode chat)
     are no longer lost.
     M3: Opener insertion is unified with cloud sync into a single effect,
     eliminating the race where one effect would overwrite the other. Flow:
     fetch cloud → merge with local → if merged is empty, insert opener. */
  useEffect(() => {
    const opener = getVoiceExample(selectedCharId, relation) ?? selectedChar.opener[language]

    ;(async () => {
      let cloudMsgs: ChatMessage[] = []
      let cloudMem: CharacterMemory | null = null

      if (auth.user) {
        if (cloudPrivacy.status === 'loading') return
        if (cloudPrivacy.status !== 'ready' || !cloudPrivacy.key) {
          setSyncStatus('privacy-locked')
        } else {
          try {
            setSyncStatus('syncing')
            const [msgs, mem] = await Promise.all([
              loadChatMessages(auth.user.id, selectedCharId, { privacyKey: cloudPrivacy.key }),
              loadCharacterMemory(auth.user.id, selectedCharId, { privacyKey: cloudPrivacy.key }),
            ])
            cloudMsgs = msgs as ChatMessage[]
            cloudMem = mem as unknown as CharacterMemory
          } catch {
            setSyncStatus('sync-failed')
          }
        }
      } else {
        setSyncStatus(null)
      }

      setMessagesByChar(prev => {
        const local = prev[selectedCharId] ?? []
        const cloudKeys = new Set(cloudMsgs.map(m => JSON.stringify({ sender: m.sender, text: m.text })))
        const localOnly = local.filter(m => !cloudKeys.has(JSON.stringify({ sender: m.sender, text: m.text })))
        const merged = [...localOnly, ...cloudMsgs]

        if (auth.user && cloudPrivacy.key && localOnly.length > 0) {
          const messagesToBackfill = localOnly.filter(m => {
            const key = `${auth.user!.id}:${selectedCharId}:${m.sender}:${m.text}`
            if (backfilledCloudKeysRef.current.has(key)) return false
            backfilledCloudKeysRef.current.add(key)
            return true
          })
          if (messagesToBackfill.length > 0) {
            persistPrivateChatMessages(auth.user.id, messagesToBackfill.map(m => ({
              character_id: selectedCharId,
              message: m.text,
              sender: m.sender,
              emotion: m.emotion ?? null,
            })), cloudPrivacy.key)
              .then(() => setSyncStatus('synced'))
              .catch(() => setSyncStatus('sync-failed'))
          } else {
            setSyncStatus('synced')
          }
        } else if (auth.user && cloudPrivacy.key) {
          setSyncStatus('synced')
        }

        if (merged.length === 0) {
          return {
            ...prev,
            [selectedCharId]: [{
              id: `opener-${selectedCharId}`,
              sender: selectedCharId,
              text: opener,
              emotion: t.openingEmotion,
              gifQuery: null,
              gifUrl: null,
            }],
          }
        }

        if (merged.length === local.length) return prev
        return { ...prev, [selectedCharId]: merged }
      })

      if (cloudMem) {
        setMemoryByChar(prev => ({ ...prev, [selectedCharId]: cloudMem }))
      }
    })()
  }, [auth.user, selectedCharId, language, relation, cloudPrivacy.status, cloudPrivacy.key]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Scene background cross-fade (chat view) ---- */
  const [currentSceneUrl, setCurrentSceneUrl] = useState<string>(pickSceneUrl([]))
  const [prevSceneUrl, setPrevSceneUrl] = useState<string | null>(null)
  const [sceneReady, setSceneReady] = useState(false)
  const chatStreamRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const next = pickSceneUrl(messages.slice(-8).map(m => m.text))
    if (next !== currentSceneUrl) {
      const id = window.setTimeout(() => {
        setSceneReady(false)
        setPrevSceneUrl(currentSceneUrl)
        setCurrentSceneUrl(next)
      }, 0)
      return () => window.clearTimeout(id)
    }
  }, [messages, currentSceneUrl])

  useEffect(() => {
    const id = setTimeout(() => setSceneReady(true), 50)
    return () => clearTimeout(id)
  }, [currentSceneUrl])

  const handleChatScroll = useCallback(() => {
    const el = chatStreamRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setChatPinnedToBottom(nearBottom)
    if (nearBottom) setUnseenBelow(false)
  }, [])

  useEffect(() => {
    const el = chatStreamRef.current
    if (!el) return
    if (chatPinnedToBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    } else {
      // Defer so we do not cascade-render inside the effect body (react-hooks/set-state-in-effect).
      queueMicrotask(() => setUnseenBelow(true))
    }
  }, [messages, chatPinnedToBottom])

  const scrollChatToBottom = useCallback(() => {
    const el = chatStreamRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    setChatPinnedToBottom(true)
    setUnseenBelow(false)
  }, [])

  /* Composer: auto-grow on input, Enter sends / Shift+Enter newline. */
  const handleComposerChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [])

  const handleComposerKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    // IME guard: Enter that confirms a composition candidate must not send.
    if (isImeComposing(e)) return
    e.preventDefault()
    e.currentTarget.form?.requestSubmit()
  }, [])

  const handleStopSending = useCallback(() => {
    chatAbortRef.current?.abort()
  }, [])

  /* Focus the composer when the chat view / active character changes
     (desktop pointers only - avoid popping the mobile keyboard). */
  useEffect(() => {
    if (view !== 'chat') return
    if (!window.matchMedia('(pointer: fine)').matches) return
    composerRef.current?.focus()
  }, [view, selectedCharId])

  /* Same for the story setup textarea while the board waits for a brief. */
  useEffect(() => {
    if (view !== 'story' || story.connectionState !== 'idle') return
    if (!window.matchMedia('(pointer: fine)').matches) return
    storyTaskRef.current?.focus()
  }, [view, story.connectionState])

  const userTurnCount = messages.filter(m => m.sender === 'user').length
  const showSavePrompt = !auth.user && userTurnCount >= 3

  /* ---- Story start ---- */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)

  // Playing story: collapse global archive sidebar to a thin handle (layout blueprint).
  useEffect(() => {
    const playing =
      story.connectionState === 'connecting'
      || story.connectionState === 'streaming'
      || story.connectionState === 'beat_paused'
      || story.connectionState === 'complete'
    if (!playing) return
    // Defer so we do not cascade-render inside the effect body (react-hooks/set-state-in-effect).
    queueMicrotask(() => setSidebarCollapsed(true))
  }, [story.connectionState])

  const handleStartStory = useCallback(async () => {
    if (!storyTask.trim()) return
    if (story.connectionState === 'connecting' || story.connectionState === 'streaming') return
    setError(null)
    try {
      if (!connection.view.canStart) {
        connection.setSheetOpen(true)
        setError(language === 'zh' ? '请先连接模型引擎' : 'Connect the model engine first')
        return
      }
      const bindId = await connection.ensureBound()
      if (connection.view.mode === 'byok' && !bindId) {
        connection.setSheetOpen(true)
        setError(
          language === 'zh'
            ? '密钥会话未就绪，请在模型引擎中重新保存密钥。'
            : 'Key session is not ready. Re-save your key in the model engine.',
        )
        return
      }
      story.setConnectionSessionId(bindId)
      await story.startStory(
        storyTask,
        selectedCharId,
        getVoiceExample(selectedCharId, relation) ?? null,
        language,
        bindId,
      )
      setStoryTask('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [storyTask, story, selectedCharId, relation, language, connection])

  /* ---- Cold open → cast → Story (default product surface) ----
   * Always seed storyTask first so free/prescribed choices share one path:
   * if connection is blocked, story stays idle and story-setup shows the
   * cold-open prompt prefilled for a manual start after the user connects.
   *
   * Double-click / double-tap guard: ref is sync (blocks re-entry before
   * React re-renders); state drives ColdOpenLanding disabled UI.
   */
  const coldOpenStartingRef = useRef(false)
  const [coldOpenStarting, setColdOpenStarting] = useState(false)
  /** Connection-gate errors stay on cold open (do not flip hasEnteredWorld). */
  const [coldOpenError, setColdOpenError] = useState<string | null>(null)

  const handleColdOpenStart = useCallback(async (payload: ColdOpenStartPayload) => {
    if (coldOpenStartingRef.current) return
    if (story.connectionState === 'connecting' || story.connectionState === 'streaming') return
    coldOpenStartingRef.current = true
    setColdOpenStarting(true)

    // Staging only — stay on cold open until connection + startStory succeed.
    // setSelectedCharId / setColdOpenChoiceId / setStoryTask early OK.
    const charId = payload.characterId as CharacterId
    setSelectedCharId(charId)
    setColdOpenChoiceId(payload.choiceId)
    setStoryTask(payload.storyPrompt)
    setColdOpenError(null)
    setError(null)
    try {
      if (!connection.view.canStart) {
        setColdOpenError(language === 'zh' ? '请先连接模型引擎' : 'Connect the model engine first')
        connection.setSheetOpen(true)
        return
      }
      const bindId = await connection.ensureBound()
      if (connection.view.mode === 'byok' && !bindId) {
        setColdOpenError(
          language === 'zh'
            ? '密钥会话未就绪，请在模型引擎中重新保存密钥。'
            : 'Key session is not ready. Re-save your key in the model engine.',
        )
        connection.setSheetOpen(true)
        return
      }
      story.setConnectionSessionId(bindId)
      const cast = characters.find(c => c.id === charId)
      const rel = relationByChar[charId] ?? cast?.relationOptions[0] ?? relation
      await story.startStory(
        payload.storyPrompt,
        charId,
        getVoiceExample(charId, rel) ?? null,
        language,
        bindId,
      )
      // Enter the world only after the story session actually started.
      setHasEnteredWorld(true)
      setSurface('story')
      setSidebarCollapsed(true)
      setStoryTask('')
      setColdOpenError(null)
    } catch (e) {
      // Keep hasEnteredWorld false; surface message on cold open for retry.
      // QA P0#4: raw English tech errors ("Failed to create session") give the
      // player nothing. Detect the common env-failure signatures and add a
      // self-check line (backend down / DB schema behind / quota).
      const raw = e instanceof Error ? e.message : String(e)
      const zh = language === 'zh'
      const lowered = raw.toLowerCase()
      let hint: string | null = null
      if (lowered.includes('failed to create session') || lowered.includes('fetch') || lowered.includes('network')) {
        hint = zh
          ? '自查：① 后端是否在跑（uvicorn main:app --port 8001）？② 数据库是否落后迁移（cd backend && alembic upgrade head）？'
          : 'Self-check: 1) is the backend running (uvicorn main:app --port 8001)? 2) is the DB behind on migrations (cd backend && alembic upgrade head)?'
      } else if (lowered.includes('402') || lowered.includes('quota')) {
        hint = zh
          ? '模型额度用完了：换自己的 key 或等明天免费额度。'
          : 'Model quota is used up: connect your own key or wait for tomorrow.'
      }
      setColdOpenError(hint ? `${raw}\n${hint}` : raw)
    } finally {
      coldOpenStartingRef.current = false
      setColdOpenStarting(false)
    }
  }, [connection, language, relation, relationByChar, setHasEnteredWorld, setSelectedCharId, setSurface, story])

  /* ---- Chat send ---- */
  const updateMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessagesByChar(prev => ({
      ...prev,
      [selectedCharId]: updater(prev[selectedCharId] ?? []),
    }))
  }, [selectedCharId, setMessagesByChar])

  const handleSend = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    const userText = message.trim()
    if (!userText || isSending) return

    // Bind / open sheet before optimistic UI so a dead BYOK session does not leave a stranded bubble.
    if (!connection.view.canStart) {
      connection.setSheetOpen(true)
      setError(language === 'zh' ? '请先连接模型引擎' : 'Connect the model engine first')
      return
    }
    setIsSending(true)
    setError(null)
    let bindId: string | null = null
    try {
      bindId = await connection.ensureBound()
      if (connection.view.mode === 'byok' && !bindId) {
        connection.setSheetOpen(true)
        throw new Error(
          language === 'zh'
            ? '密钥会话未就绪，请在模型引擎中重新保存密钥。'
            : 'Key session is not ready. Re-save your key in the model engine.',
        )
      }
      story.setConnectionSessionId(bindId)
    } catch (e) {
      setIsSending(false)
      setError(e instanceof Error ? e.message : String(e))
      return
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: userText,
    }
    const nextHistory = [...messages, userMsg]
    updateMessages(prev => [...prev, userMsg])
    setMessage('')
    if (composerRef.current) composerRef.current.style.height = 'auto'
    setChatPinnedToBottom(true)

    // Update memory with user turn
    const updatedAfterUser = charMemory.addTurn(selectedCharId, 'user', userText, currentMemory)

    if (auth.user && cloudPrivacy.key) {
      setSyncStatus('syncing')
      persistPrivateChatMessage(auth.user.id, {
        character_id: selectedCharId,
        message: userText,
        sender: 'user',
        emotion: null,
      }, cloudPrivacy.key)
        .then(() => setSyncStatus('synced'))
        .catch(() => setSyncStatus('sync-failed'))
    } else if (auth.user) {
      setSyncStatus('privacy-locked')
    }

    const controller = new AbortController()
    chatAbortRef.current = controller
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        signal: controller.signal,
        body: JSON.stringify({
          characterId: selectedCharId,
          userInput: userText,
          relation,
          mode,
          history: nextHistory.slice(-10).map(m => ({ sender: m.sender, text: m.text })),
          language,
          llmProvider: connection.view.providerId,
          modelId: connection.view.modelId,
          voiceExample: getVoiceExample(selectedCharId, relation) ?? null,
          memorySummary: updatedAfterUser.summary || undefined,
          keyFacts: updatedAfterUser.keyFacts.length > 0 ? updatedAfterUser.keyFacts : undefined,
          connectionSessionId: bindId,
        }),
      })
      if (!res.ok) {
        const quotaErr = await parseQuotaError(res.clone())
        if (quotaErr) {
          connection.setSheetOpen(true)
          void quota.refresh()
          throw new Error(
            quotaErr.message
              || (language === 'zh'
                ? '今日免费次数已用完。连接你自己的密钥继续。'
                : 'Free demo credits used up. Connect your own key to continue.'),
          )
        }
        const detail = await res.json().catch(() => ({ error: 'Server error' }))
        const msg =
          typeof detail.detail === 'object' && detail.detail?.message
            ? detail.detail.message
            : detail.error || detail.detail || 'Chat failed'
        throw new Error(msg)
      }
      const data = await res.json()
      void quota.refresh()

      if (mode === 'crew') {
        const debateReplies: ChatMessage[] = []
        if (Array.isArray(data.debate_logs)) {
          data.debate_logs.forEach((log: Record<string, unknown>) => {
            const sender = log.sender as CharacterId
            debateReplies.push({
              id: crypto.randomUUID(),
              sender,
              text: log.text as string,
              emotion: log.emotion as string | undefined,
              gifQuery: log.gifQuery as string | null,
              gifUrl: resolveGifUrl(sender, log.emotion as string | null, log.gifQuery as string | null),
              thinking: log.thinking as string | undefined,
              toolExecuted: log.tool_executed as string | null,
              toolLog: log.tool_log as string | null,
            })
          })
        }
        updateMessages(current => [...current, ...debateReplies])

        if (auth.user && cloudPrivacy.key && debateReplies.length > 0) {
          setSyncStatus('syncing')
          persistPrivateChatMessages(auth.user.id, debateReplies.map(reply => ({
            character_id: selectedCharId,
            message: reply.text,
            sender: reply.sender,
            emotion: reply.emotion ?? null,
          })), cloudPrivacy.key)
            .then(() => setSyncStatus('synced'))
            .catch(() => setSyncStatus('sync-failed'))
        } else if (auth.user) {
          setSyncStatus('privacy-locked')
        }
      } else {
        const reply: ChatMessage = {
          id: crypto.randomUUID(),
          sender: selectedCharId,
          text: data.reply_text,
          emotion: data.emotion_state,
          gifQuery: data.gif_search_query,
          gifUrl: resolveGifUrl(selectedCharId, data.emotion_state, data.gif_search_query),
          thinking: data.thinking,
          toolExecuted: data.tool_executed,
          toolLog: data.tool_log,
        }
        updateMessages(current => [...current, reply])

        // Update memory with character reply
        const finalMemory = charMemory.addTurn(selectedCharId, selectedCharId, reply.text, updatedAfterUser)
        setMemoryByChar(prev => ({ ...prev, [selectedCharId]: finalMemory }))

        // Persist to Supabase if authenticated
        if (auth.user && cloudPrivacy.key) {
          setSyncStatus('syncing')
          persistPrivateChatMessage(auth.user.id, {
            character_id: selectedCharId,
            message: reply.text,
            sender: selectedCharId,
            emotion: reply.emotion ?? null,
          }, cloudPrivacy.key)
            .then(() => setSyncStatus('synced'))
            .catch(() => setSyncStatus('sync-failed'))
          persistPrivateCharacterMemory(auth.user.id, {
            character_id: selectedCharId,
            summary: finalMemory.summary,
            key_facts: finalMemory.keyFacts as unknown as Array<Record<string, unknown>>,
          }, cloudPrivacy.key)
            .then(() => setSyncStatus('synced'))
            .catch(() => setSyncStatus('sync-failed'))
        } else if (auth.user) {
          setSyncStatus('privacy-locked')
        }
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) {
        // Roll back the optimistic bubble and restore the draft so retry is one click.
        updateMessages(prev => prev.filter(m => m.id !== userMsg.id))
        setMessage(userText)
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null
      setIsSending(false)
      const el = composerRef.current
      if (el) {
        el.focus()
        // Re-grow for a restored draft (or collapse after a cleared one).
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 140)}px`
      }
    }
  }, [message, isSending, messages, selectedCharId, relation, mode, language, connection, story, updateMessages, auth, currentMemory, charMemory, setMemoryByChar, cloudPrivacy.key])

  /* ---- Character change ---- */
  const handleCharChange = useCallback((id: CharacterId) => {
    setSelectedCharId(id)
    setRelationByChar(prev => {
      const savedRelation = prev[id]
      if (savedRelation !== undefined) {
        const charName = characters.find(c => c.id === id)?.name ?? id
        setRelationNotice(
          `${charName}: ${getRelationLabel(savedRelation, language)}`,
        )
      }
      return { ...prev, [id]: savedRelation ?? characters.find(c => c.id === id)!.relationOptions[0] }
    })
    setMessage('')
    setError(null)
  }, [setSelectedCharId, setRelationByChar, language])

  const handleReturnToLanding = useCallback(() => {
    story.reset()
    setStoryTask('')
    setError(null)
    setColdOpenChoiceId(null)
    // QA P0#3: returning to the landing must re-enter through the cold open,
    // not fall through to the legacy idle setup form. Resetting the
    // knowledge track keeps the brief → crisis → cast chain as the single
    // entry; forcing surface='story' prevents a stale 'direct' surface from
    // rendering the old setup screen after reset.
    setKnowledgeTrack(null)
    setSurface('story')
    setHasEnteredWorld(false)
  }, [story, setHasEnteredWorld, setKnowledgeTrack, setSurface])

  const storyContextSummary = useMemo(() => {
    const spoken = story.events
      .filter(evt => evt.type === 'agent_speak')
      .slice(-4)
      .map(evt => `${evt.data.character_id ?? 'Character'}: ${evt.data.content ?? ''}`)
      .join('\n')
    return [story.outline, spoken].filter(Boolean).join('\n\n')
  }, [story.events, story.outline])

  // Streaming clears manual pin so paced autoplay can own the stage.
  useEffect(() => {
    if (story.connectionState !== 'streaming') return
    queueMicrotask(() => setPinnedStoryEventIndex(null))
  }, [story.connectionState, story.events.length])

  useEffect(() => {
    // New session: reset stage pacing only. Do NOT force-open GIF or beat rail
    // (drama default: GIF off, timeline folded so stage/dialogue/decision win).
    queueMicrotask(() => {
      setPinnedStoryEventIndex(null)
      setOutlineExpanded(false)
      setTimelineRailOpen(false)
      setStoryGifHidden(true)
      setStageCardPos(0)
      stageShownAtRef.current = null
    })
  }, [story.sessionId])

  // Card events only (scene / think / speak / act). Status & deltas stay off-stage.
  const stageCardIndices = useMemo(
    () => listStageCardIndices(story.events, STORY_CARD_EVENT_TYPES),
    [story.events],
  )

  // Dwell ~7s per card so think/speak/scene don't flash past the reader.
  useEffect(() => {
    if (stageCardIndices.length === 0) {
      stageShownAtRef.current = null
      return
    }
    // First card of a session: show immediately.
    if (stageShownAtRef.current == null) {
      stageShownAtRef.current = Date.now()
      setStageCardPos(0)
      return
    }
    // Clamp if history was trimmed (MAX_EVENTS) or session replaced mid-flight.
    setStageCardPos((pos) => Math.min(pos, stageCardIndices.length - 1))
  }, [stageCardIndices])

  useEffect(() => {
    // Manual pin freezes autoplay until cleared.
    if (pinnedStoryEventIndex != null) return
    if (stageCardIndices.length === 0) return
    if (stageCardPos >= stageCardIndices.length - 1) return

    const shownAt = stageShownAtRef.current ?? Date.now()
    stageShownAtRef.current = shownAt
    const remaining = Math.max(0, STAGE_DWELL_MS - (Date.now() - shownAt))
    const id = window.setTimeout(() => {
      setStageCardPos((pos) => {
        if (pos >= stageCardIndices.length - 1) return pos
        stageShownAtRef.current = Date.now()
        return pos + 1
      })
    }, remaining)
    return () => window.clearTimeout(id)
  }, [pinnedStoryEventIndex, stageCardIndices, stageCardPos])

  const currentStoryEvent = useMemo(() => {
    if (
      pinnedStoryEventIndex != null
      && pinnedStoryEventIndex >= 0
      && pinnedStoryEventIndex < story.events.length
    ) {
      const pinned = story.events[pinnedStoryEventIndex]
      if (STORY_CARD_EVENT_TYPES.has(pinned.type)) return pinned
    }
    if (stageCardIndices.length === 0) return null
    const safePos = Math.min(Math.max(stageCardPos, 0), stageCardIndices.length - 1)
    return story.events[stageCardIndices[safePos]] ?? null
  }, [pinnedStoryEventIndex, stageCardIndices, stageCardPos, story.events])
  /** Stage position currently on the paper (pin wins over autoplay pos). */
  const activeStagePos = useMemo(() => {
    if (stageCardIndices.length === 0) return 0
    if (pinnedStoryEventIndex != null) {
      const idx = stageCardIndices.indexOf(pinnedStoryEventIndex)
      if (idx >= 0) return idx
    }
    return Math.min(Math.max(stageCardPos, 0), stageCardIndices.length - 1)
  }, [pinnedStoryEventIndex, stageCardIndices, stageCardPos])

  /* Manual browsing pins the card, freezing paced autoplay (same contract
     as clicking a timeline row). */
  const stepStageCard = useCallback((delta: number) => {
    if (stageCardIndices.length === 0) return
    const next = Math.min(Math.max(activeStagePos + delta, 0), stageCardIndices.length - 1)
    if (next === activeStagePos) return
    setPinnedStoryEventIndex(stageCardIndices[next])
    stageShownAtRef.current = Date.now()
  }, [activeStagePos, stageCardIndices])

  /* Keep the active beat visible on the rail as autoplay advances. */
  useEffect(() => {
    if (!timelineRailOpen) return
    const container = storyEventsRef.current
    if (!container) return
    const active = container.querySelector('.story-event.is-active')
    if (active instanceof HTMLElement) {
      active.scrollIntoView({
        block: 'nearest',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
    }
  }, [currentStoryEvent, timelineRailOpen])

  const returnToLiveStage = useCallback(() => {
    setPinnedStoryEventIndex(null)
    setStageCardPos(Math.max(stageCardIndices.length - 1, 0))
    stageShownAtRef.current = Date.now()
  }, [stageCardIndices])

  /* Stage keyboard nav: ←/→ browse cards; Enter continues at a beat pause.
     Skips editable / interactive targets so typing and buttons keep working. */
  const storyConnectionState = story.connectionState
  const storySendAction = story.sendAction
  useEffect(() => {
    if (view !== 'story') return
    const live = storyConnectionState === 'streaming'
      || storyConnectionState === 'beat_paused'
      || storyConnectionState === 'complete'
    if (!live) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (
        tag === 'INPUT'
        || tag === 'TEXTAREA'
        || tag === 'SELECT'
        || target?.isContentEditable
      ) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        stepStageCard(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        stepStageCard(1)
      } else if (
        e.key === 'Enter'
        && storyConnectionState === 'beat_paused'
        && tag !== 'BUTTON'
        && tag !== 'A'
      ) {
        e.preventDefault()
        void storySendAction('continue', undefined, selectedCharId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, storyConnectionState, stepStageCard, storySendAction, selectedCharId])

  const currentStoryText = currentStoryEvent ? getStoryEventSummary(currentStoryEvent, language) : t.sceneFallback
  const currentStoryTypeChip = currentStoryEvent
    ? getEventTypeChip(currentStoryEvent, language)
    : t.currentBeat
  const currentStoryTitle = currentStoryEvent ? getEventTitle(currentStoryEvent, language) : t.currentBeat
  const currentStoryHeading = getStoryCardHeading(currentStoryEvent, currentStoryTitle)
  const currentStoryEventType = currentStoryEvent?.type ?? 'empty'
  const isSpeakCard = currentStoryEventType === 'agent_speak'
  const isThinkCard = currentStoryEventType === 'agent_think'
  const isActCard = currentStoryEventType === 'agent_act'
  const isSceneCard = currentStoryEventType === 'scene_change'
  const storyEmotionClass = emotionStageClass(
    (currentStoryEvent?.data?.emotion_state as string | undefined)
      ?? (findLastStoryEvent(story.events, e => typeof e.data.emotion_state === 'string')?.data.emotion_state as string | undefined),
  )
  const currentStorySpeakerId = isSpeakCard
    ? DISPLAY_NAME_TO_ID[currentStoryEvent!.data.character_id as string]
    : null
  const currentStorySpeakerText = isSpeakCard
    ? ((currentStoryEvent!.data.content as string) ?? '')
    : ''
  const latestWorldDelta = useMemo(
    () => findLastStoryEvent(story.events, evt => evt.type === 'world_state_delta'),
    [story.events],
  )
  const latestWorldDeltaText = latestWorldDelta
    ? getStoryEventTimelineSummary(latestWorldDelta, language, 96)
    : ''
  const storyLocation = useMemo(() => {
    const latest = findLastStoryEvent(story.events, evt => evt.type === 'scene_change')
    if (!latest) return t.storyLocationFallback
    const destination = typeof latest.data.to_scene === 'string' ? latest.data.to_scene : ''
    const cleaned = playerFacingSceneText(destination || getStoryEventSummary(latest, language))
    return (cleaned || t.storyLocationFallback).slice(0, 40)
  }, [language, story, t.storyLocationFallback])
  // World clock probe: surface the advancing time/weather from the latest
  // world_state_delta so the player can see the world keep moving.
  const storyWorldClock = useMemo(() => {
    const clock = latestWorldDelta?.data?.world_clock
    if (!Array.isArray(clock) || clock.length !== 3) return null
    const [day, tod, weather] = clock
    if (typeof day !== 'number' || typeof tod !== 'string' || typeof weather !== 'string') return null
    const todLabel = language === 'zh'
      ? ({ morning: '清晨', afternoon: '午后', evening: '傍晚', night: '深夜' } as Record<string, string>)[tod] ?? tod
      : tod
    const weatherLabel = language === 'zh'
      ? ({ clear: '晴', sunny: '晴', cloudy: '多云', overcast: '阴', rainy: '雨' } as Record<string, string>)[weather] ?? weather
      : weather
    return language === 'zh'
      ? `第 ${day + 1} 天 · ${todLabel} · ${weatherLabel}`
      : `Day ${day + 1} · ${todLabel} · ${weatherLabel}`
  }, [latestWorldDelta?.data?.world_clock, language])
  const storyBeatLabel = language === 'zh'
    ? `节点 ${Math.max(story.beatIndex, 1)}`
    : `Beat ${Math.max(story.beatIndex, 1)}`
  const storyTensionLabel = formatEmotionLabel(
    (currentStoryEvent?.data?.emotion_state as string | undefined)
      ?? (findLastStoryEvent(story.events, e => typeof e.data.emotion_state === 'string')?.data.emotion_state as string | undefined),
    language,
  ) || (language === 'zh' ? '未定' : 'Unset')

  const handleContinueChapter = useCallback(async () => {
    const base = defaultStoryPrompt(language)
    const prompt = language === 'zh'
      ? `${base}\n\n作为第二章继续。保留第一章后果，提高压力，不要重开故事。\n\n第一章上下文：\n${storyContextSummary || '暂无上下文。'}`
      : `${base}\n\nContinue this as Chapter 2. Keep the consequences of Chapter 1 intact, raise the pressure, and do not restart the story.\n\nChapter 1 context:\n${storyContextSummary || 'No previous context was captured.'}`
    await story.startStory(prompt, selectedCharId, getVoiceExample(selectedCharId, relation) ?? null, language)
  }, [relation, selectedCharId, story, storyContextSummary, language])

  const handleBranchStory = useCallback(async () => {
    const base = defaultStoryPrompt(language)
    const prompt = language === 'zh'
      ? `${base}\n\n从关键节点分叉。保留设定，但因角色冲突走向完全不同的剧情。\n\n原上下文：\n${storyContextSummary || '暂无上下文。'}`
      : `${base}\n\nBranch from the earlier decisive beat. Preserve the setup, then take the plot in a sharply different direction chosen by character conflict rather than coincidence.\n\nOriginal context:\n${storyContextSummary || 'No previous context was captured.'}`
    await story.startStory(prompt, selectedCharId, getVoiceExample(selectedCharId, relation) ?? null, language)
  }, [relation, selectedCharId, story, storyContextSummary, language])

  const handleReplayBeat = useCallback(async () => {
    const base = defaultStoryPrompt(language)
    const prompt = language === 'zh'
      ? `${base}\n\n用更贴近的角度重演上一拍。同一前提，但揭示之前未明说的动机或恐惧。\n\n先前上下文：\n${storyContextSummary || '暂无上下文。'}`
      : `${base}\n\nReplay the last beat from a more intimate angle. Keep the same premise, but reveal a hidden motive or unspoken fear that was not explicit before.\n\nPrevious context:\n${storyContextSummary || 'No previous context was captured.'}`
    await story.startStory(prompt, selectedCharId, getVoiceExample(selectedCharId, relation) ?? null, language)
  }, [relation, selectedCharId, story, storyContextSummary, language])

  /* ---- Cold open (brief question → crisis → cast) ---- */
  if (!hasEnteredWorld) {
    return (
      <>
        <ColdOpenLanding
          language={language}
          knowledgeTrack={knowledgeTrack}
          onKnowledgePick={(t) => setKnowledgeTrack(t)}
          onStart={handleColdOpenStart}
          onOpenSettings={() => {
            setColdOpenError(null)
            connection.setSheetOpen(true)
          }}
          onLanguageChange={(lang) => setLanguage(lang)}
          starting={coldOpenStarting}
          error={coldOpenError}
        />
        <ConnectionSheet conn={connection} language={language} />
      </>
    )
  }

  // Cold-open crisis chips only on beat 0; later pauses must not reuse them
  // (D08: call_saul×Saul still showed 接电话/谈价/编说辞 on beat 1–2).
  const dramaSuggestions: DramaSuggestion[] = dramaSuggestionsForBeat(
    story.beatIndex,
    language,
    {
      choiceId: coldOpenChoiceId ?? undefined,
      characterId: selectedCharId,
    },
    latestWorldDeltaText || currentStoryText.slice(0, 80),
  )

  return (
    <>
      {/* P0-3: auto-resume probe toast. Shown when the mount-time HEAD
          probe finds the saved sessionId is dead (404). Dismissable +
          auto-dismisses after 8s (handled in the hook). */}
      {story.resumeToast && (
        <div className="resume-notice" role="status" aria-live="polite">
          <span>{story.resumeToast}</span>
          <button
            type="button"
            className="resume-notice__close"
            onClick={story.dismissResumeToast}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {/* P0-4: relation preservation notice when the user returns to a
          character whose saved relation is being reused. */}
      {relationNotice && (
        <div className="relation-notice" role="status" aria-live="polite">
          <span>↻ {relationNotice}</span>
          <button
            type="button"
            className="resume-notice__close"
            onClick={() => setRelationNotice(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <main
        className={`app-shell${sidebarCollapsed ? ' app-shell--sidebar-collapsed' : ''}${view === 'story' && sidebarCollapsed ? ' app-shell--story-focus' : ''}`}
        lang={language === 'zh' ? 'zh-CN' : 'en'}
      >
        <div className={`sidebar-wrapper ${sidebarCollapsed ? 'sidebar-wrapper--collapsed' : ''}`}>
          <button
            type="button"
            className="sidebar__toggle"
            onClick={() => setSidebarCollapsed(v => !v)}
            aria-label={sidebarCollapsed ? t.archiveHandle : (language === 'zh' ? '收起档案' : 'Hide archive')}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? t.archiveHandle : '▸'}
          </button>
          <aside className="sidebar">
            {/* Brand */}
            <div className="brand">
          <span className="brand-icon" />
          <div>
            <h1>{t.storyTitle}</h1>
            <p>{t.tagline}</p>
          </div>
          <button type="button" className="brand-return" onClick={handleReturnToLanding}>
            {t.returnToLanding}
          </button>
        </div>

        {/* Auth section */}
        <AuthSection auth={auth} language={language} syncStatus={syncStatus} />

        {/* Character grid */}
        <section>
          <h2>{t.character}</h2>
          <div className="char-grid">
            {characters.map(c => (
              <button
                key={c.id}
                className={`char-card ${c.id === selectedCharId ? 'selected' : ''}`}
                onClick={() => handleCharChange(c.id)}
                style={{ '--char-color': c.color } as CSSProperties}
                title={c.oneLiner[language]}
              >
                <Silhouette characterId={c.id} name={c.name} size={42} />
                <div className="char-card__info">
                  <strong>{c.name}</strong>
                  <span className="char-card__hint">{c.oneLiner[language]}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Settings drawer: language, view, relation, mode, model/quota — off the stage */}
        <details className="archive-settings">
          <summary className="archive-settings__summary">
            {language === 'zh' ? '设置' : 'Settings'}
          </summary>
          <section>
            <span className="field-label">{t.language}</span>
            <div className="seg-control">
              <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} aria-pressed={language === 'en'}>{t.langEn}</button>
              <button className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')} aria-pressed={language === 'zh'}>{t.langZh}</button>
            </div>
          </section>

          <section>
            <span className="field-label">{t.view}</span>
            <div className="seg-control">
              <button className={surface === 'story' ? 'active' : ''} onClick={() => setSurface('story')} aria-pressed={surface === 'story'}>{t.story}</button>
              <button className={surface === 'direct' ? 'active' : ''} onClick={() => setSurface('direct')} aria-pressed={surface === 'direct'}>{t.direct}</button>
              <button className={surface === 'crew' ? 'active' : ''} onClick={() => setSurface('crew')} aria-pressed={surface === 'crew'}>{t.crew}</button>
            </div>
          </section>

          <section className="connection-sidebar-block">
            <span className="field-label">{t.model}</span>
            <ConnectionChip conn={connection} language={language} />
            <p className={`quota-pill${quota.remaining <= 2 && !quota.byok ? ' is-low' : ''}`}>
              {quota.byok
                ? (language === 'zh' ? '自备密钥 · 不占平台次数' : 'Your key · not metered')
                : (language === 'zh'
                  ? `${quota.tier === 'user' ? '登录赠送' : '游客'} ${quota.remaining}/${quota.limit} 次`
                  : `${quota.tier === 'user' ? 'Member' : 'Guest'} ${quota.remaining}/${quota.limit}`)}
            </p>
          </section>
        </details>
          </aside>
        </div>

        <ConnectionSheet conn={connection} language={language} />

      {/* ===================== MAIN PANEL ===================== */}
      {view === 'story' ? (
        /* ---------- Story View ---------- */
        <section className="story-panel story-panel--drama">
          <header className="story-header story-hud story-hud--minimal">
            <div className="story-hud__brand">
              <span className="brand-icon" aria-hidden="true" />
              <div>
                <p>{t.schema}</p>
                <h2>{t.narrativeStream}</h2>
              </div>
            </div>
            <div className="story-hud__metric">
              <span>{t.scene}</span>
              <strong>{storyBeatLabel}</strong>
            </div>
            <div className="story-hud__metric story-hud__metric--wide">
              <span>{t.location}</span>
              <strong>{storyLocation}</strong>
              <small>{selectedChar.name} / {getRelationLabel(relation, language)}</small>
              {storyWorldClock && <small className="world-clock">{storyWorldClock}</small>}
            </div>
            <div className="story-hud__metric">
              <span>{t.tension}</span>
              <strong title={storyTensionLabel}>{storyTensionLabel}</strong>
            </div>
            {/* QA P2#10: language switch reachable in-game, not only on the
                cold open toolbar. Quiet pill, same seg-control grammar. */}
            <div className="story-hud__lang" role="group" aria-label={language === 'zh' ? '语言' : 'Language'}>
              <button
                type="button"
                className={language === 'zh' ? 'is-active' : ''}
                onClick={() => setLanguage('zh')}
                aria-pressed={language === 'zh'}
              >
                中文
              </button>
              <button
                type="button"
                className={language === 'en' ? 'is-active' : ''}
                onClick={() => setLanguage('en')}
                aria-pressed={language === 'en'}
              >
                EN
              </button>
            </div>
            {/* Model/quota only when credits are low — not permanent HUD chrome. */}
            {!quota.byok && quota.remaining <= 2 && (
              <div className="story-hud__metric story-hud__connection story-hud__connection--low">
                <span>{t.model}</span>
                <ConnectionChip conn={connection} language={language} compact />
                <small className="quota-pill quota-pill--compact is-low">
                  {language === 'zh'
                    ? `${quota.tier === 'user' ? '登录' : '游客'} ${quota.remaining}`
                    : `${quota.tier === 'user' ? 'Member' : 'Guest'} ${quota.remaining}`}
                </small>
              </div>
            )}
            <button
              type="button"
              className="story-hud__chat-link"
              onClick={() => setSurface('direct')}
            >
              {t.switchToChat}
            </button>
          </header>

          {/* Idle: task input */}
          {story.connectionState === 'idle' && (
            <div className="story-setup">
              <h3>{t.setStage}</h3>
              <p>{t.setStageHint}</p>
              <label className="story-setup__relation" htmlFor="setup-relation">
                <span>{t.relation}</span>
                <select
                  id="setup-relation"
                  value={relation}
                  onChange={e => setRelationByChar(prev => ({ ...prev, [selectedCharId]: e.target.value }))}
                >
                  {selectedChar.relationOptions.map(opt => (
                    <option key={opt} value={opt}>{formatRelation(selectedChar, opt, language)}</option>
                  ))}
                </select>
              </label>
              <textarea
                ref={storyTaskRef}
                value={storyTask}
                onChange={e => setStoryTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && storyTask.trim()) {
                    e.preventDefault()
                    void handleStartStory()
                  }
                }}
                placeholder={t.placeholder}
              />
              <button
                type="button"
                onClick={handleStartStory}
                disabled={!storyTask.trim()}
              >
                {t.startStory}
              </button>
              <span className="story-setup__kbd-hint">{t.storyStartHint}</span>
              {error && <ErrorBox message={error} onDismiss={() => setError(null)} />}
            </div>
          )}

          {/* Connecting — diegetic line, no SaaS spinner dots */}
          {story.connectionState === 'connecting' && (
            <div className="story-status story-status--pulse" aria-live="polite">
              <p>{story.isResuming
                ? (t.resumingStory)
                : t.connecting}</p>
            </div>
          )}

          {/* Error / interrupted — always speaks plainly and offers an exit (QA P0#1/#2) */}
          {story.connectionState === 'error' && (
            <div className="story-error">
              <p>
                ⚠{' '}
                {story.streamFailure?.kind === 'timeout'
                  ? (language === 'zh'
                    ? '剧情演出中断了 90 秒没有回应。进度已保存——可以直接重试。'
                    : 'The story stalled mid-beat with no response for 90s. Your progress is saved — retry now.')
                  : story.streamFailure?.kind === 'network'
                    ? (language === 'zh'
                      ? '与导演的连接断开，且自动重连未成功。进度已保存——可以重试。'
                      : 'The connection dropped and auto-reconnect failed. Your progress is saved — retry.')
                    : story.getCharState(selectedCharId).error}
              </p>
              {story.sessionId && (
                <button type="button" onClick={story.reconnect}>
                  {language === 'zh' ? '重试演出' : t.reconnect}
                </button>
              )}
              <button type="button" onClick={story.reset}>
                {t.restart}
              </button>
              {error && <ErrorBox message={error} onDismiss={() => setError(null)} />}
            </div>
          )}

          {/* Streaming / beat_paused / complete: live event feed */}
          {(story.connectionState === 'streaming'
            || story.connectionState === 'beat_paused'
            || story.connectionState === 'complete') && (
            <div className={`story-stream story-stream--${story.connectionState}${timelineRailOpen ? '' : ' story-stream--rail-collapsed'}`}>
              <div className="story-board__brief">
                {story.outline && (
                  <div className={`story-outline${outlineExpanded ? ' is-expanded' : ' is-collapsed'}`}>
                    <div className="story-outline__header">
                      <strong>{t.storyOutline}</strong>
                      <button
                        type="button"
                        className="story-outline__toggle"
                        aria-expanded={outlineExpanded}
                        onClick={() => setOutlineExpanded(v => !v)}
                      >
                        {outlineExpanded ? t.outlineCollapse : t.outlineExpand}
                      </button>
                    </div>
                    {!outlineExpanded && (
                      <div className="story-outline__summary">{formatStoryPlanPreview(story.outline, language)}</div>
                    )}
                    {outlineExpanded && (
                      <p className="story-outline__body">{story.outline}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Stage (~70%) first, narrow beat rail (~25%) second - blueprint. */}
              <div className="story-board__grid">
                <section
                  className={[
                    'story-scene-card',
                    `story-scene-card--${currentStoryEventType}`,
                    storyEmotionClass ? `story-scene-card--emotion-${storyEmotionClass}` : '',
                  ].filter(Boolean).join(' ')}
                >
                  <div
                    className="story-scene-card__paper"
                    key={
                      pinnedStoryEventIndex
                      ?? stageCardIndices[stageCardPos]
                      ?? currentStoryEventType
                    }
                  >
                    <div className="story-scene-card__meta">
                      <span className={`story-scene-card__chip story-scene-card__chip--${currentStoryEventType}`}>
                        {currentStoryTypeChip}
                      </span>
                      {/* Think/act: character stays in meta; speak uses a dialogue heading below. */}
                      {!isSpeakCard
                        && currentStoryHeading
                        && currentStoryHeading !== currentStoryTypeChip && (
                        <span className="story-scene-card__speaker">{currentStoryHeading}</span>
                      )}
                      {stageCardIndices.length > 1 && (
                        <span className="story-scene-card__nav">
                          <button
                            type="button"
                            aria-label={t.stagePrev}
                            title={t.stagePrev}
                            disabled={activeStagePos <= 0}
                            onClick={() => stepStageCard(-1)}
                          >‹</button>
                          <span className="story-scene-card__pos">{activeStagePos + 1}/{stageCardIndices.length}</span>
                          <button
                            type="button"
                            aria-label={t.stageNext}
                            title={t.stageNext}
                            disabled={activeStagePos >= stageCardIndices.length - 1}
                            onClick={() => stepStageCard(1)}
                          >›</button>
                        </span>
                      )}
                      {pinnedStoryEventIndex != null && (
                        <button
                          type="button"
                          className="story-scene-card__live"
                          onClick={returnToLiveStage}
                        >
                          {t.backToLive}
                        </button>
                      )}
                      <button
                        type="button"
                        className="story-scene-card__gif-toggle"
                        onClick={() => setStoryGifHidden(v => !v)}
                      >
                        {storyGifHidden ? t.gifToggleShow : t.gifToggleHide}
                      </button>
                    </div>
                    {/* Disco Elysium weight: character name is the dialogue heading. */}
                    {isSpeakCard && currentStoryHeading && (
                      <h3 className="story-scene-card__name">{currentStoryHeading}</h3>
                    )}
                    {isSceneCard && (
                      <p className="story-scene-card__scene-label">
                        {language === 'zh' ? '场景转换' : 'Scene'}
                      </p>
                    )}
                    <p className={[
                      'story-scene-card__quote',
                      isThinkCard ? 'is-thought' : '',
                      isActCard ? 'is-stage-dir' : '',
                      isSpeakCard ? 'is-speak' : '',
                      isSceneCard ? 'is-scene' : '',
                    ].filter(Boolean).join(' ')}>
                      {currentStoryText}
                    </p>
                    {currentStorySpeakerId && currentStorySpeakerText && (
                      <VoicePlayer
                        text={currentStorySpeakerText}
                        characterId={currentStorySpeakerId}
                        language={language}
                        connectionSessionId={connection.connectionSessionId}
                      />
                    )}
                    {!storyGifHidden && (
                      <GifCard
                        src={currentStoryEvent ? getStoryEventGif(currentStoryEvent) : null}
                        alt={t.gifTrigger}
                      />
                    )}
                  </div>
                </section>

                {timelineRailOpen ? (
                  <aside className="story-timeline" aria-label={t.sceneTimeline}>
                    <div className="story-timeline__head">
                      <h3>{t.sceneTimeline}</h3>
                      <button
                        type="button"
                        className="story-timeline__toggle"
                        aria-expanded
                        onClick={() => setTimelineRailOpen(false)}
                      >
                        {t.timelineCollapse}
                      </button>
                    </div>
                    <p className="story-timeline__hint">{t.timelineHint}</p>
                    <div className="story-events" ref={storyEventsRef}>
                      {story.events.map((evt, i) => {
                        const isCardType = STORY_CARD_EVENT_TYPES.has(evt.type)
                        const isActive = evt === currentStoryEvent
                        const summary = getStoryEventTimelineSummary(evt, language)
                        if (!summary && evt.type !== 'error' && evt.type !== 'complete') {
                          if (evt.type === 'status' || evt.type === 'outline' || evt.type === 'beat_ready') {
                            return null
                          }
                        }
                        const isAct = evt.type === 'agent_act'
                        const isThink = evt.type === 'agent_think'
                        const isDelta = evt.type === 'world_state_delta'
                        return (
                          <button
                            key={`${i}-${evt.type}-${evt.received_at ?? ''}`}
                            type="button"
                            className={[
                              'story-event',
                              `story-event--${evt.type}`,
                              isActive ? 'is-active' : '',
                              isCardType ? 'story-event--selectable' : '',
                              isAct ? 'story-event--stage-dir' : '',
                              isThink ? 'story-event--inner' : '',
                              isDelta ? 'story-event--delta-thin' : '',
                            ].filter(Boolean).join(' ')}
                            onClick={() => {
                              if (isCardType) setPinnedStoryEventIndex(i)
                            }}
                            disabled={!isCardType}
                          >
                            <span className="story-event__dot" aria-hidden="true" />
                            {!isAct && (
                              <strong className={isThink ? 'story-event__label--inner' : undefined}>
                                {getEventTitle(evt, language)}
                              </strong>
                            )}
                            {summary && (
                              <p className={[
                                'story-event__summary',
                                isThink ? 'thought' : '',
                                isAct ? 'stage-dir' : '',
                              ].filter(Boolean).join(' ')}>
                                {summary}
                              </p>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </aside>
                ) : (
                  /* Collapsed: one edge tab only - no empty full-height black rail. */
                  <button
                    type="button"
                    className="story-timeline-handle"
                    aria-expanded={false}
                    aria-label={t.timelineExpand}
                    onClick={() => setTimelineRailOpen(true)}
                  >
                    <span className="story-timeline-handle__label">{t.sceneTimeline}</span>
                    <span className="story-timeline-handle__chev" aria-hidden="true">‹</span>
                  </button>
                )}
              </div>

              {/* Consequences: thin strip, never primary reading surface.
                  QA P1#6: the 96-char preview truncated mid-sentence with no
                  way to read the rest — make the full text expandable. */}
              {latestWorldDelta && (
                <details className="story-delta-strip" aria-label={t.eventWorldDelta}>
                  <summary>
                    <span>{t.eventWorldDelta}</span>
                    <p>{latestWorldDeltaText}</p>
                  </summary>
                  <p className="story-delta-strip__full">
                    {getStoryEventTimelineSummary(latestWorldDelta, language, 4000)}
                  </p>
                </details>
              )}

              {/* Streaming indicator — diegetic, no SaaS dots */}
              {story.connectionState === 'streaming' && (
                <div className="streaming-indicator streaming-indicator--diegetic" aria-live="polite">
                  {story.autoContinued ? (
                    <span className="auto-continue-notice">
                      {t.autoContinue}
                    </span>
                  ) : (
                    <p className="streaming-indicator__line">{t.streamingUnfold}</p>
                  )}
                </div>
              )}

              {/* Decision layer: say / do / observe + free text (AI Dungeon grammar). */}
              {story.connectionState === 'beat_paused' && (
                <div className="beat-paused beat-paused--drama">
                  <DramaDecisionBar
                    language={language}
                    suggestions={dramaSuggestions}
                    freeValue={decisionFree}
                    onFreeChange={setDecisionFree}
                    firstTimeHint={
                      story.beatIndex === 0 && !dramaHintSeen
                        ? language === 'zh'
                          ? '点快捷行动，或直接打字——你要说的话、做的事，都算数。'
                          : 'Tap a move, or type your own — what you say or do all counts.'
                        : undefined
                    }
                    onPick={(s) => {
                      setDramaHintSeen(true)
                      void story.sendAction(
                        'redirect',
                        { redirect_prompt: s.payload },
                        selectedCharId,
                      )
                      setDecisionFree('')
                    }}
                    onContinue={() => {
                      setDramaHintSeen(true)
                      void story.sendAction('continue', undefined, selectedCharId)
                    }}
                    onFreeSubmit={() => {
                      const text = decisionFree.trim()
                      if (!text) return
                      setDramaHintSeen(true)
                      void story.sendAction(
                        'redirect',
                        { redirect_prompt: text },
                        selectedCharId,
                      )
                      setDecisionFree('')
                    }}
                    disabled={
                      story.connectionState !== 'beat_paused'
                    }
                  />
                  <details className="beat-paused__advanced">
                    <summary>
                      {language === 'zh' ? '更多导演控制' : 'More director controls'}
                    </summary>
                    <BeatControls
                      t={t}
                      characters={characters}
                      onContinue={() => story.sendAction('continue', undefined, selectedCharId)}
                      onStop={() => story.sendAction('stop', undefined, selectedCharId)}
                      onRedirect={(prompt) => story.sendAction('redirect', { redirect_prompt: prompt }, selectedCharId)}
                      onSwitchPerspective={(charId) => story.sendAction('switch_perspective', { target_character: charId }, selectedCharId)}
                    />
                  </details>
                </div>
              )}

              {story.connectionState === 'complete' && (
                <div className="story-complete">
                  <p>🎬 {t.storyComplete}</p>
                  <div className="story-complete__actions">
                    {/* Plot map is the primary complete action — review the spine before branching. */}
                    {story.sessionId && (
                      <button
                        type="button"
                        className="story-complete__map story-complete__map--primary"
                        onClick={() => setPlotMapOpen(true)}
                      >
                        {t.plotNetShow}
                      </button>
                    )}
                    <button type="button" onClick={handleContinueChapter}>{t.continueChapter}</button>
                    <button type="button" onClick={handleBranchStory}>{t.branchStory}</button>
                    <button type="button" onClick={handleReplayBeat}>{t.replayBeat}</button>
                    <button type="button" onClick={story.reset}>{t.startAgain}</button>
                  </div>
                  <p className="story-complete__hint">
                    {story.sessionId
                      ? (language === 'zh'
                        ? '先打开局面地图回看因果与未明之处，再选下一章或分叉。'
                        : 'Open the situation map first — see what landed and what is still fog — then start the next chapter or branch.')
                      : t.storyCompleteHint}
                  </p>
                </div>
              )}

              {error && <ErrorBox message={error} onDismiss={() => setError(null)} />}
            </div>
          )}
        </section>
      ) : (
        /* ---------- Chat View ---------- */
        <section className={`chat-panel ${sceneReady ? 'is-crossfade' : ''}`}>
          <div className="scene-layer scene-layer--prev" style={{ backgroundImage: prevSceneUrl ? `url(${prevSceneUrl})` : 'none' } as CSSProperties} />
          <div className="scene-layer scene-layer--current" style={{ backgroundImage: `url(${currentSceneUrl})` } as CSSProperties} />
          <header className="chat-header">
            <div>
              <p>{mode === 'crew' ? t.crewScene : t.privateScene}</p>
                  <h2>
                    {t.chatHeaderWith.replace('{character}', selectedChar.name).replace('{relation}', getRelationLabel(relation, language))}
                  </h2>
                  {/* QA P1#7: chat was a dead end — no visible way back to a
                      live story. Offer the return only when one exists. */}
                  {story.sessionId && story.connectionState !== 'idle' && (
                    <button
                      type="button"
                      className="chat-header__back-to-story"
                      onClick={() => setSurface('story')}
                    >
                      {language === 'zh' ? '← 返回剧情' : '← Back to the story'}
                    </button>
                  )}
                  {showSavePrompt && (
                    <div className="save-prompt">
                      {t.savePrompt}
                </div>
              )}
            </div>
            <span className="schema-pill">{t.schema}</span>
            <label className="chat-header__relation" htmlFor="chat-relation">
              <span className="sr-only">{t.relation}</span>
              <select
                id="chat-relation"
                value={relation}
                onChange={e => setRelationByChar(prev => ({ ...prev, [selectedCharId]: e.target.value }))}
                aria-label={t.relation}
              >
                {selectedChar.relationOptions.map(opt => (
                  <option key={opt} value={opt}>{formatRelation(selectedChar, opt, language)}</option>
                ))}
              </select>
            </label>
          </header>

          <div className="chat-stream" ref={chatStreamRef} onScroll={handleChatScroll}>
            {messages.map(msg => {
              const isUser = msg.sender === 'user'
              const senderChar = isUser ? null : characters.find(c => c.id === msg.sender)
              const senderName = senderChar?.name ?? (isUser ? t.you : (msg.sender as string))
              const senderColor = senderChar?.color ?? selectedChar.color
              return (
                <article
                  key={msg.id}
                  className={`msg ${isUser ? 'msg--user' : 'msg--char'}`}
                  style={{ '--char-color': isUser ? 'var(--color-bb-yellow)' : senderColor } as CSSProperties}
                >
                  <div className="msg-avatar" style={{ '--char-color': isUser ? 'var(--color-bb-yellow)' : senderColor } as CSSProperties}>
                    {isUser ? <span className="avatar-letter">{t.you[0]}</span> : <Silhouette characterId={msg.sender as CharacterId} name={senderName} size={36} />}
                  </div>
                  <div className="msg-body">
                    <div className="msg-meta">
                      <strong>{isUser ? `${t.you}, ${getRelationLabel(relation, language)}` : senderName}</strong>
                      {msg.emotion && <span>{msg.emotion}</span>}
                    </div>
                    <p>{msg.text}</p>
                    {msg.toolExecuted && (
                      <div className="tool-pill">
                        <span>{t.toolLabel}: <code>{msg.toolExecuted}</code></span>
                        {msg.toolLog && <p>{msg.toolLog}</p>}
                      </div>
                    )}
                    {!isUser && (
                      <VoicePlayer
                        text={msg.text}
                        characterId={msg.sender as CharacterId}
                        language={language}
                        connectionSessionId={connection.connectionSessionId}
                      />
                    )}
                    <GifCard src={msg.id.startsWith('opener-') ? null : msg.gifUrl} alt={msg.gifQuery ? t.gifTrigger : ''} />
                  </div>
                </article>
              )
            })}
            <div className="chat-end" aria-hidden="true" />
          </div>

          {unseenBelow && !chatPinnedToBottom && (
            <button
              type="button"
              className="chat-scroll-latest"
              onClick={scrollChatToBottom}
            >
              ↓ {t.newMessages}
            </button>
          )}

          <div className="chat-footer">
            {isSending && (
              <div className="typing" aria-live="polite">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            )}
            {error && <ErrorBox message={error} onDismiss={() => setError(null)} />}

            <form className="composer" onSubmit={handleSend}>
              <textarea
                ref={composerRef}
                rows={1}
                value={message}
                onChange={handleComposerChange}
                onKeyDown={handleComposerKeyDown}
                placeholder={t.messagePlaceholder.replace('{character}', selectedChar.name).replace('{relation}', getRelationLabel(relation, language))}
              />
              {isSending ? (
                <button type="button" className="composer__stop" onClick={handleStopSending}>
                  ⏹ {t.stopGenerating}
                </button>
              ) : (
                <button type="submit" disabled={!message.trim()}>
                  {t.send}
                </button>
              )}
            </form>
          </div>
        </section>
      )}

      <PlotGraphPanel
        sessionId={story.sessionId}
        open={plotMapOpen}
        onClose={() => setPlotMapOpen(false)}
        language={language}
        labels={{
          plotNet: t.plotNet,
          plotNetShow: t.plotNetShow,
          plotNetHide: t.plotNetHide,
          plotNetLoad: t.plotNetLoad,
          plotNetError: t.plotNetError,
          plotNetEmpty: t.plotNetEmpty,
          plotNetPast: t.plotNetPast,
          plotNetNow: t.plotNetNow,
          plotNetFog: t.plotNetFog,
          plotNetKnown: t.plotNetKnown,
          plotNetShifting: t.plotNetShifting,
          plotNetCast: t.plotNetCast,
          plotNetNoPast: t.plotNetNoPast,
          plotNetNoFog: t.plotNetNoFog,
          plotNetHint: t.plotNetHint,
          plotNetBeats: t.plotNetBeats,
          plotNetCastMeta: t.plotNetCastMeta,
          plotNetLines: t.plotNetLines,
          plotNetNowTag: t.plotNetNowTag,
          plotNetFogTag: t.plotNetFogTag,
        }}
      />

      {/* Agent Harness: lab only (?lab=1 or /lab). Users deal with lies, not agent logs. */}
      {showAgentLab && <AgentHarnessPanel language={language} />}
    </main>
    </>
  )
}

export default App
