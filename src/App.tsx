import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
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

type CharacterId = 'walter' | 'jesse' | 'skyler' | 'saul' | 'mike' | 'gus'

const DISPLAY_NAME_TO_ID: Record<string, CharacterId> = {
  'Walter White': 'walter', 'Walter': 'walter',
  'Jesse Pinkman': 'jesse', 'Jesse': 'jesse',
  'Skyler White': 'skyler', 'Skyler': 'skyler',
  'Saul Goodman': 'saul', 'Saul': 'saul',
  'Mike Ehrmantraut': 'mike', 'Mike': 'mike',
  'Gus Fring': 'gus', 'Gus': 'gus',
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

function formatStoryPlanPreview(outline: string, lang: Language): string {
  const beats = outline
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^\d+[.)]\s+/.test(line))
  const count = Math.max(beats.length, 1)
  return lang === 'zh'
    ? `已规划 ${count} 个剧情节拍。具体走向会随游玩逐步揭示。`
    : `${count} story beats planned. The details will reveal as you play.`
}

function getStoryEventSummary(evt: StoryEvent, lang: Language): string {
  switch (evt.type) {
    case 'scene_change':
      return ((evt.data.description as string) ?? '')
        .replace(/^Transitioning to:\s*/i, '')
        .replace(/^切换至[：:]\s*/, '')
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
    zh: '导演正在分析任务…',
  },
  'Director outlined {n} beat(s). Beginning roleplay…': {
    en: 'Director outlined {n} beat(s). Beginning roleplay…',
    zh: '导演已规划 {n} 个剧情节拍。开始角色扮演…',
  },
  'No action received - continuing automatically.': {
    en: 'No action received - continuing automatically.',
    zh: '未收到玩家操作 - 自动继续…',
  },
  'All beats rendered. Roleplay outline complete.': {
    en: 'All beats rendered. Roleplay outline complete.',
    zh: '全部剧情节点已完成。任务收束。',
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

function truncateText(text: string, maxLen: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLen) return cleaned
  return `${cleaned.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`
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
}

const uiText: Record<Language, Record<string, string>> = {
  en: {
    tagline: 'Character dossiers, pressure scenes, and consequence-driven roleplay.',
    landingSubtitle: 'Step into Albuquerque. Everything you say stays with them.',
    landingVoice: 'The door is open. Don\'t start with manners.',
    landingPreview: 'You are not who you say you are. That is fine. Start talking.',
    landingStep1: 'Choose',
    landingStep2: 'Anchor',
    landingStep3: 'Chat',
    character: 'Active Profile',
    language: 'Language',
    relation: 'Relation',
    view: 'View',
    chat: 'Chat',
    story: 'Story',
    mode: 'Mode',
    direct: 'Direct Chat',
    crew: 'Crew Debate',
    model: 'Model Backend',
    storyTitle: 'ABQ Roleplay Lab',
    setStage: 'Set the Stage',
    setStageHint: 'Describe the story you want in natural language. The scene board will play it beat by beat, pausing at pressure points for your decision.',
    placeholder: 'e.g. Walter White needs to secure a new methylamine supply from Gus Fring without Skyler finding out…',
    startStory: 'Start Story',
    directing: 'Blocking the scene…',
    narrativeStream: 'Narrative Stream',
    eventFeed: 'Fine-grained event-driven narrative',
    directorDecision: 'Choose the next move:',
    switchToChat: 'Switch to Chat',
    you: 'You',
    send: 'Send',
    sending: 'Thinking…',
    messagePlaceholder: 'Negotiate with {character} as their {relation}…',
    privateScene: 'Private Scene',
    crewScene: 'Crew Debate',
    schema: 'Scene Board',
    gifTrigger: 'Scene beat',
    connected: 'Stream live',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
    storyComplete: 'Story complete. All beats rendered.',
    continue: 'Continue',
    stop: 'Stop',
    storyOutline: 'Story Outline',
    paused: 'Paused',
    toolLabel: 'Tool Call',
    eventOutline: 'Story Outline',
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
    sceneFallback: 'Scene board is waiting for the first beat.',
    storyLocationFallback: 'North of ABQ',
    outlineExpand: 'Show outline',
    outlineCollapse: 'Hide outline',
    timelineHint: 'Tap a beat to focus the stage',
    archiveHandle: 'Archive',
    timelineCollapse: 'Hide rail',
    timelineExpand: 'Show rail',
    gifToggleHide: 'Hide GIF',
    gifToggleShow: 'Show GIF',
  },
  zh: {
    tagline: '进入阿尔伯克基的角色档案、任务现场与导演式剧情推进。',
    landingSubtitle: '走进阿尔伯克基。你的每一句话，他们都会记住。',
    landingVoice: 'The door is open. Don\'t start with manners.',
    landingPreview: '你不是你自称的那个人。没关系。先开口。',
    landingStep1: '选择',
    landingStep2: '锚定',
    landingStep3: '对话',
    character: '角色档案',
    language: '语言',
    relation: '身份关系',
    view: '游玩模式',
    chat: '角色会谈',
    story: '剧情任务',
    mode: '会谈形式',
    direct: '单人场景',
    crew: '群像会谈',
    model: '引擎线路',
    storyTitle: 'ABQ Roleplay Lab',
    setStage: '任务简报',
    setStageHint: '写下这局的目标、风险和想看到的冲突。场景会分镜推进剧情，并在关键节点等待你的选择。',
    placeholder: '例如：Walter White 需要想办法从 Gus Fring 那里拿到新的甲胺供应，同时不能让 Skyler 发现…',
    startStory: '开始任务',
    directing: '现场正在调度…',
    narrativeStream: '任务现场',
    eventFeed: '实时剧情事件',
    directorDecision: '关键节点：选择下一步',
    switchToChat: '返回会谈',
    you: '你',
    send: '发送',
    sending: '生成回应…',
    messagePlaceholder: '以{relation}身份对 {character} 说…',
    privateScene: '单人场景',
    crewScene: '群像会谈',
    schema: '场景记录',
    gifTrigger: '镜头节点',
    connected: '现场已连接',
    connecting: '连接现场…',
    disconnected: '已断开',
    storyComplete: '任务结束。所有剧情节点已完成。',
    continue: '继续',
    stop: '停止',
    storyOutline: '任务大纲',
    paused: '已暂停',
    toolLabel: '工具调用',
    eventOutline: '故事大纲',
    eventSceneChange: '场景建立',
    eventSpeaks: '说',
    eventThinks: '内心',
    eventActs: '行动',
    eventBeatReady: '关键选择',
    eventWorldDelta: '后果',
    eventStatus: '现场状态',
    eventComplete: '任务收束',
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
    sceneFallback: '场景记录正在等待第一个剧情节点。',
    storyLocationFallback: '阿尔伯克基北部',
    outlineExpand: '展开大纲',
    outlineCollapse: '收起大纲',
    timelineHint: '点选分镜，主舞台切换',
    archiveHandle: '档案',
    timelineCollapse: '收起分镜',
    timelineExpand: '展开分镜',
    gifToggleHide: '关 GIF',
    gifToggleShow: '开 GIF',
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
        <div className="redirect-control">
          <input
            value={redirectText}
            onChange={e => setRedirectText(e.target.value)}
            placeholder={labels.redirectPlaceholder}
            disabled={pending !== null}
          />
          <button
            onClick={wrap('redirect', () => {
              if (redirectText.trim()) {
                const p = redirectText
                setRedirectOpen(false)
                setRedirectText('')
                return onRedirect(p)
              }
              return Promise.resolve()
            })}
            disabled={pending !== null || !redirectText.trim()}
          >
            {labels.submit}
          </button>
          <button onClick={() => setRedirectOpen(false)} disabled={pending !== null}>{labels.cancel}</button>
        </div>
      )}
      {!perspectiveOpen && (
        <button onClick={() => setPerspectiveOpen(true)} disabled={pending !== null}>{labels.switchPerspective}</button>
      )}
      {perspectiveOpen && (
        <div className="perspective-control">
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

const DEFAULT_STORY_PROMPT_EN =
  "Gus Fring sits across from Walter White in the Los Pollos Hermanos office. The air is still. Gus studies Walt with calm precision. Walt's pride wars with his fear. Jesse is waiting in the parking lot, not knowing this meeting could change everything."
const DEFAULT_STORY_PROMPT_ZH =
  "古斯·弗林格与沃尔特·怀特对坐在洛斯波罗斯·赫尔曼诺斯餐厅办公室。空气凝固。古斯冷静审视沃尔特。沃尔特的自尊与恐惧交战。杰西在停车场等候，不知道这次会面可能改变一切。"
function defaultStoryPrompt(lang: Language): string {
  return lang === 'zh' ? DEFAULT_STORY_PROMPT_ZH : DEFAULT_STORY_PROMPT_EN
}

/* ------------------------------------------------------------------ */
/*  App                                                               */
/* ------------------------------------------------------------------ */

function App() {
  // Language: use browser preference on first visit, then persist
  const defaultLanguage: Language = navigator.language.startsWith('zh') ? 'zh' : 'en'
  const [storedLanguage, setLanguage] = usePersistedState<Language | null>('language', null)
  const language: Language = storedLanguage ?? defaultLanguage
  const t = uiText[language]

  const [selectedCharId, setSelectedCharId] = usePersistedState<CharacterId>('character', 'walter')
  const selectedChar = characters.find(c => c.id === selectedCharId) ?? characters[0]

  const [hasEnteredWorld, setHasEnteredWorld] = usePersistedState<boolean>('enteredWorld', false)

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

  const [view, setView] = usePersistedState<View>('view', 'chat')
  const [mode, setMode] = usePersistedState<ChatMode>('mode', 'direct')
  const connection = useConnection()
  const auth = useAuth()
  const quota = useQuota(connection.connectionSessionId, auth.user?.id ?? null)

  // Chat state
  const [messagesByChar, setMessagesByChar] = usePersistedState<Record<string, ChatMessage[]>>('messages', {})
  const messages = useMemo(() => messagesByChar[selectedCharId] ?? [], [messagesByChar, selectedCharId])
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Story board: outline collapsed by default to free stage space. */
  const [outlineExpanded, setOutlineExpanded] = useState(false)
  /** null = auto-follow latest card event; number = user pinned a timeline row. */
  const [pinnedStoryEventIndex, setPinnedStoryEventIndex] = useState<number | null>(null)
  /** Position within stage-card indices (not raw event index). */
  const [stageCardPos, setStageCardPos] = useState(0)
  const stageShownAtRef = useRef<number | null>(null)
  /** Narrow beat rail open by default; user can fold to give stage full width. */
  const [timelineRailOpen, setTimelineRailOpen] = useState(true)
  /** GIF on stage can be muted so paper text stays primary. */
  const [storyGifHidden, setStoryGifHidden] = useState(false)
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

  useEffect(() => {
    const stream = chatStreamRef.current
    if (!stream) return
    stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  const userTurnCount = messages.filter(m => m.sender === 'user').length
  const showSavePrompt = !auth.user && userTurnCount >= 3

  /* ---- Story start ---- */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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
        setError(language === 'zh' ? '请先连接模型线路' : 'Connect a model line first')
        return
      }
      const bindId = await connection.ensureBound()
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

  /* ---- Enter world from landing screen ---- */
  const handleEnterWorld = useCallback(() => {
    setHasEnteredWorld(true)
    setView('chat')
    setStoryTask(defaultStoryPrompt(language))
    story.reset()
  }, [setHasEnteredWorld, setView, story, language])

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

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: userText,
    }
    const nextHistory = [...messages, userMsg]
    updateMessages(prev => [...prev, userMsg])
    setMessage('')
    setIsSending(true)
    setError(null)

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

    try {
      const bindId = await connection.ensureBound()
      story.setConnectionSessionId(bindId)
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
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
                ? '今日免费额度已用完。请连接你自己的密钥继续。'
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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsSending(false)
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
    setHasEnteredWorld(false)
  }, [story, setHasEnteredWorld])

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
    queueMicrotask(() => {
      setPinnedStoryEventIndex(null)
      setOutlineExpanded(false)
      setTimelineRailOpen(true)
      setStoryGifHidden(false)
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
  const currentStoryText = currentStoryEvent ? getStoryEventSummary(currentStoryEvent, language) : t.sceneFallback
  const currentStoryTypeChip = currentStoryEvent
    ? getEventTypeChip(currentStoryEvent, language)
    : t.currentBeat
  const currentStoryTitle = currentStoryEvent ? getEventTitle(currentStoryEvent, language) : t.currentBeat
  const currentStoryHeading = getStoryCardHeading(currentStoryEvent, currentStoryTitle)
  const currentStorySpeakerId = currentStoryEvent?.type === 'agent_speak'
    ? DISPLAY_NAME_TO_ID[currentStoryEvent.data.character_id as string]
    : null
  const currentStorySpeakerText = currentStoryEvent?.type === 'agent_speak'
    ? ((currentStoryEvent.data.content as string) ?? '')
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
    return (destination || getStoryEventSummary(latest, language)).slice(0, 64)
  }, [language, story, t.storyLocationFallback])
  const storyBeatLabel = language === 'zh'
    ? `节点 ${Math.max(story.beatIndex, 1)}`
    : `Beat ${Math.max(story.beatIndex, 1)}`
  const storyTensionLabel = formatEmotionLabel(
    (currentStoryEvent?.data?.emotion_state as string | undefined)
      ?? (findLastStoryEvent(story.events, e => typeof e.data.emotion_state === 'string')?.data.emotion_state as string | undefined),
    language,
  )

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

  /* ---- Render ---- */
  if (!hasEnteredWorld) {
    return (
      <div className="landing-screen">
        {/* Loop 10: separate bg layer so Ken-Burns can drift without moving type */}
        <div className="landing-screen__bg" aria-hidden="true" />
        <div className="landing-screen__content">
          <h1 className="landing-screen__title">
            BREAKING BAD
            <span className="landing-screen__title-accent">World Lines</span>
          </h1>
          <p className="landing-screen__description">{t.landingSubtitle}</p>
          <div className="landing-screen__divider" />
          {/* Loop 10 Gap 2: one in-character voice line (original, not a show quote) */}
          <p className="landing-screen__voice">{t.landingVoice}</p>
          <button className="landing-screen__enter" onClick={handleEnterWorld} type="button">
            {t.enterWorld}
            <span className="landing-screen__enter-arrow">&rarr;</span>
          </button>
        </div>
        {/* Loop 10 Gap 3: muted chat-bubble preview of what the CTA opens into */}
        <div className="landing-screen__preview" aria-hidden="true">
          <div className="landing-preview-bubble">
            <span className="landing-preview-bubble__name">Walter</span>
            <span className="landing-preview-bubble__text">{t.landingPreview}</span>
          </div>
        </div>
      </div>
    )
  }

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
        className={`app-shell${sidebarCollapsed ? ' app-shell--sidebar-collapsed' : ''}`}
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

        {/* Language */}
        <section>
          <span className="field-label">{t.language}</span>
          <div className="seg-control">
            <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} aria-pressed={language === 'en'}>{t.langEn}</button>
            <button className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')} aria-pressed={language === 'zh'}>{t.langZh}</button>
          </div>
        </section>

        {/* View toggle */}
        <section>
          <span className="field-label">{t.view}</span>
          <div className="seg-control">
            <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>{t.chat}</button>
            <button className={view === 'story' ? 'active' : ''} onClick={() => setView('story')}>{t.story}</button>
          </div>
        </section>

        {/* Relation */}
        <section>
          <label htmlFor="relation">{t.relation}</label>
          <select
            id="relation"
            value={relation}
            onChange={e => setRelationByChar(prev => ({ ...prev, [selectedCharId]: e.target.value }))}
          >
            {selectedChar.relationOptions.map(opt => (
              <option key={opt} value={opt}>{formatRelation(selectedChar, opt, language)}</option>
            ))}
          </select>
        </section>

        {/* Mode (chat only) */}
        {view === 'chat' && (
          <section>
            <span className="field-label">{t.mode}</span>
            <div className="seg-control">
              <button className={mode === 'direct' ? 'active' : ''} onClick={() => setMode('direct')}>{t.direct}</button>
              <button className={mode === 'crew' ? 'active' : ''} onClick={() => setMode('crew')}>{t.crew}</button>
            </div>
          </section>
        )}

        {/* Model line - BYOK branding entry + free credits */}
        <section className="connection-sidebar-block">
          <span className="field-label">{t.model}</span>
          <ConnectionChip conn={connection} language={language} />
          <p className={`quota-pill${quota.remaining <= 2 && !quota.byok ? ' is-low' : ''}`}>
            {quota.byok
              ? (language === 'zh' ? '自备密钥 · 不占平台额度' : 'Your key · not metered')
              : (language === 'zh'
                ? `${quota.tier === 'user' ? '登录福利' : '游客'} ${quota.remaining}/${quota.limit} 分`
                : `${quota.tier === 'user' ? 'Member' : 'Guest'} ${quota.remaining}/${quota.limit}`)}
          </p>
        </section>
          </aside>
        </div>

        <ConnectionSheet conn={connection} language={language} />

      {/* ===================== MAIN PANEL ===================== */}
      {view === 'story' ? (
        /* ---------- Story View ---------- */
        <section className="story-panel">
          <header className="story-header story-hud">
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
            </div>
            <div className="story-hud__metric">
              <span>{t.tension}</span>
              <strong title={storyTensionLabel}>{storyTensionLabel}</strong>
            </div>
            <div className="story-hud__metric story-hud__connection">
              <span>{t.model}</span>
              <ConnectionChip conn={connection} language={language} compact />
              <small className={`quota-pill quota-pill--compact${quota.remaining <= 2 && !quota.byok ? ' is-low' : ''}`}>
                {quota.byok
                  ? (language === 'zh' ? '自备密钥' : 'BYOK')
                  : (language === 'zh'
                    ? `${quota.tier === 'user' ? '登录' : '游客'} ${quota.remaining}`
                    : `${quota.tier === 'user' ? 'Member' : 'Guest'} ${quota.remaining}`)}
              </small>
            </div>
            <button type="button" onClick={() => setView('chat')}>{t.switchToChat}</button>
          </header>

          {/* Idle: task input */}
          {story.connectionState === 'idle' && (
            <div className="story-setup">
              <h3>{t.setStage}</h3>
              <p>{t.setStageHint}</p>
              <textarea
                value={storyTask}
                onChange={e => setStoryTask(e.target.value)}
                placeholder={t.placeholder}
              />
              <button
                type="button"
                onClick={handleStartStory}
                disabled={!storyTask.trim()}
              >
                {t.startStory}
              </button>
              {error && <div className="error-box">{error}</div>}
            </div>
          )}

          {/* Connecting */}
          {story.connectionState === 'connecting' && (
            <div className="story-status" aria-live="polite">
              <div className="typing">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
              <p>{story.isResuming
                ? (t.resumingStory)
                : t.directing}</p>
            </div>
          )}

          {/* Error */}
          {story.connectionState === 'error' && (
            <div className="story-error">
              <p>⚠ {story.getCharState(selectedCharId).error}</p>
              {story.sessionId && (
                <button type="button" onClick={story.reconnect}>
                  {t.reconnect}
                </button>
              )}
              <button type="button" onClick={story.reset}>
                {t.restart}
              </button>
              {error && <div className="error-box">{error}</div>}
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
                <section className={`story-scene-card story-scene-card--${currentStoryEvent?.type ?? 'empty'}`}>
                  <div className="story-scene-card__paper">
                    <div className="story-scene-card__meta">
                      <span className={`story-scene-card__chip story-scene-card__chip--${currentStoryEvent?.type ?? 'empty'}`}>
                        {currentStoryTypeChip}
                      </span>
                      {currentStoryHeading && currentStoryHeading !== currentStoryTypeChip && (
                        <span className="story-scene-card__speaker">{currentStoryHeading}</span>
                      )}
                      <button
                        type="button"
                        className="story-scene-card__gif-toggle"
                        onClick={() => setStoryGifHidden(v => !v)}
                      >
                        {storyGifHidden ? t.gifToggleShow : t.gifToggleHide}
                      </button>
                    </div>
                    <p className={[
                      'story-scene-card__quote',
                      currentStoryEvent?.type === 'agent_think' ? 'is-thought' : '',
                      currentStoryEvent?.type === 'agent_act' ? 'is-stage-dir' : '',
                      currentStoryEvent?.type === 'agent_speak' ? 'is-speak' : '',
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
                    <div className="story-events">
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

              {/* Consequences: thin strip, never primary reading surface. */}
              {latestWorldDeltaText && (
                <div className="story-delta-strip" aria-label={t.eventWorldDelta}>
                  <span>{t.eventWorldDelta}</span>
                  <p>{latestWorldDeltaText}</p>
                </div>
              )}

              {/* Streaming indicator */}
              {story.connectionState === 'streaming' && (
                <div className="streaming-indicator" aria-live="polite">
                  {story.autoContinued ? (
                    <span className="auto-continue-notice">
                      {t.autoContinue}
                    </span>
                  ) : (
                    <div className="typing">
                      <span className="dot" /><span className="dot" /><span className="dot" />
                    </div>
                  )}
                </div>
              )}

              {/* Decision bar: only when paused, sticky bottom. */}
              {story.connectionState === 'beat_paused' && (
                <div className="beat-paused">
                  <p>{t.directorDecision}</p>
                  <BeatControls
                    t={t}
                    characters={characters}
                    onContinue={() => story.sendAction('continue', undefined, selectedCharId)}
                    onStop={() => story.sendAction('stop', undefined, selectedCharId)}
                    onRedirect={(prompt) => story.sendAction('redirect', { redirect_prompt: prompt }, selectedCharId)}
                    onSwitchPerspective={(charId) => story.sendAction('switch_perspective', { target_character: charId }, selectedCharId)}
                  />
                </div>
              )}

              {story.connectionState === 'complete' && (
                <div className="story-complete">
                  <p>🎬 {t.storyComplete}</p>
                  <div className="story-complete__actions">
                    <button type="button" onClick={handleContinueChapter}>{t.continueChapter}</button>
                    <button type="button" onClick={handleBranchStory}>{t.branchStory}</button>
                    <button type="button" onClick={handleReplayBeat}>{t.replayBeat}</button>
                    <button type="button" onClick={story.reset}>{t.startAgain}</button>
                    {story.sessionId && (
                      <button
                        type="button"
                        className="story-complete__map"
                        onClick={() => setPlotMapOpen(true)}
                      >
                        {t.plotNetShow}
                      </button>
                    )}
                  </div>
                  <p className="story-complete__hint">{t.storyCompleteHint}</p>
                </div>
              )}

              {error && <div className="error-box">{error}</div>}
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
                  {showSavePrompt && (
                    <div className="save-prompt">
                      {t.savePrompt}
                </div>
              )}
            </div>
            <span className="schema-pill">{t.schema}</span>
          </header>

          <div className="chat-stream" ref={chatStreamRef}>
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

          <div className="chat-footer">
            {isSending && (
              <div className="typing" aria-live="polite">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            )}
            {error && <div className="error-box">{error}</div>}

            <form className="composer" onSubmit={handleSend}>
              <input
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder={t.messagePlaceholder.replace('{character}', selectedChar.name).replace('{relation}', getRelationLabel(relation, language))}
              />
              <button type="submit" disabled={isSending || !message.trim()}>
                {isSending ? t.sending : t.send}
              </button>
            </form>
          </div>
        </section>
      )}

      <PlotGraphPanel
        sessionId={story.sessionId}
        open={plotMapOpen}
        onClose={() => setPlotMapOpen(false)}
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
        }}
      />
    </main>
    </>
  )
}

export default App
