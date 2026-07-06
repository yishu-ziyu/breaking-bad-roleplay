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
import { VoicePlayer } from './components/VoicePlayer'
import { pickSceneUrl } from './lib/sceneBackgrounds'
import { resolveGifUrl } from './lib/gifResolver'
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

function resolveStoryEventGif(evt: StoryEvent): string | null {
  if (evt.type !== 'agent_speak') return null
  const charId = DISPLAY_NAME_TO_ID[evt.data.character_id as string]
  if (!charId) return null
  return resolveGifUrl(
    charId,
    (evt.data.emotion_state as string) ?? null,
    (evt.data.gif_search_query as string) ?? null,
  )
}

function getEventTitle(evt: StoryEvent, lang: Language): string {
  const charId = (evt.data.character_id as string) ?? ''
  const t = uiText[lang]
  switch (evt.type) {
    case 'outline': return t.eventOutline
    case 'scene_change': return t.eventSceneChange
    case 'agent_speak': return `${charId} ${t.eventSpeaks}`
    case 'agent_think': return `${charId} ${t.eventThinks}`
    case 'agent_act': return `${charId} ${t.eventActs}`
    case 'beat_ready': return t.eventBeatReady
    case 'world_state_delta': return t.eventWorldDelta
    case 'status': return t.eventStatus
    case 'complete': return t.eventComplete
    case 'error': return t.eventError
    default: return evt.type
  }
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
    tagline: 'Stateful Breaking Bad autonomous agents running Plan-Reflect cognitive loops.',
    landingSubtitle: 'Pick a character. Choose your relationship. Start a conversation that matters.',
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
    setStageHint: 'Describe the story you want in natural language. The Director will autonomously act out the plot, pausing at each beat for your decision.',
    placeholder: 'e.g. Walter White needs to secure a new methylamine supply from Gus Fring without Skyler finding out…',
    startStory: 'Start Story',
    directing: 'Directing…',
    narrativeStream: 'Narrative Stream',
    eventFeed: 'Fine-grained event-driven narrative',
    directorDecision: 'Director awaits your decision:',
    switchToChat: 'Switch to Chat',
    you: 'You',
    send: 'Send',
    sending: 'Thinking…',
    messagePlaceholder: 'Negotiate with {character} as their {relation}…',
    privateScene: 'Private Scene',
    crewScene: 'Crew Debate',
    schema: 'Director-Driven',
    gifTrigger: 'GIF',
    connected: 'Stream live',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
    storyComplete: 'Story complete. All beats rendered.',
    continue: 'Continue',
    stop: 'Stop',
    storyOutline: 'Story Outline',
    paused: 'Paused',
    eventOutline: 'Story Outline',
    eventSceneChange: 'Scene Change',
    eventSpeaks: 'speaks',
    eventThinks: 'thinks',
    eventActs: 'acts',
    eventBeatReady: 'Director awaits your decision',
    eventWorldDelta: 'World State Delta',
    eventStatus: 'Status',
    eventComplete: 'Story Complete',
    eventError: 'Error',
    openingEmotion: 'opening pressure',
    enterWorld: 'ENTER THE WORLD',
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
    autoContinue: 'Director auto-continuing (5min idle)...',
    streaming: 'Streaming',
    returnToLanding: '↩ Return to Landing',
    continueChapter: 'Start Chapter 2',
    branchStory: 'Try a Different Branch',
    replayBeat: 'Replay Last Beat',
    startAgain: 'Start Again',
    storyCompleteHint: 'Each new beat will pick up the last chapter\'s context.',
  },
  zh: {
    tagline: '进入阿尔伯克基的角色档案、任务现场与导演式剧情推进。',
    landingSubtitle: '选一个角色。确定你的关系。开始一段有分量的对话。',
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
    setStageHint: '写下这局的目标、风险和想看到的冲突。导演会分镜推进剧情，并在关键节点等待你的选择。',
    placeholder: '例如：Walter White 需要想办法从 Gus Fring 那里拿到新的甲胺供应，同时不能让 Skyler 发现…',
    startStory: '开始任务',
    directing: '导演正在分镜…',
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
    schema: '导演系统',
    gifTrigger: '镜头参考',
    connected: '现场已连接',
    connecting: '连接现场…',
    disconnected: '已断开',
    storyComplete: '任务结束。所有剧情节点已完成。',
    continue: '继续',
    stop: '停止',
    storyOutline: '任务大纲',
    paused: '已暂停',
    eventOutline: '故事大纲',
    eventSceneChange: '场景切换',
    eventSpeaks: '说',
    eventThinks: '思考',
    eventActs: '行动',
    eventBeatReady: '导演等你决策',
    eventWorldDelta: '世界状态变化',
    eventStatus: '状态更新',
    eventComplete: '剧情完结',
    eventError: '错误',
    reconnect: '重连',
    restart: '重新开始',
    autoContinue: '导演 5 分钟无操作，自动继续中…',
    streaming: '播放中',
    resumingStory: '正在恢复上次剧情…',
    openingEmotion: '开场压迫',
    langZh: '中文',
    enterWorld: '进入世界',
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
  },
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getRelationLabel(relation: string, lang: Language): string {
  return relationLabels[relation]?.[lang] ?? relation
}

function formatRelation(char: Character, relation: string, lang: Language): string {
  const label = getRelationLabel(relation, lang)
  return lang === 'zh' ? `${char.name} 的${label}` : `${char.name}'s ${label}`
}

/* ------------------------------------------------------------------ */
/*  BeatControls — decision UI at beat_ready                          */
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

const DEFAULT_STORY_PROMPT: string = "Gus Fring sits across from Walter White in the Los Pollos Hermanos office. The air is still. Gus studies Walt with calm precision. Walt's pride wars with his fear. Jesse is waiting in the parking lot, not knowing this meeting could change everything."

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
  const [autoPlayMode, setAutoPlayMode] = useState(false)

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
  const [llmProvider] = usePersistedState<string>('llm-v2', 'cliproxy')

  // Chat state
  const [messagesByChar, setMessagesByChar] = usePersistedState<Record<string, ChatMessage[]>>('messages', {})
  const messages = useMemo(() => messagesByChar[selectedCharId] ?? [], [messagesByChar, selectedCharId])
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auth state
  const auth = useAuth()
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
    const openerGif = resolveGifUrl(selectedCharId, 'opening pressure', null)

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
              gifUrl: openerGif,
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
  const chatEndRef = useRef<HTMLDivElement>(null)

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
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const userTurnCount = messages.filter(m => m.sender === 'user').length
  const showSavePrompt = !auth.user && userTurnCount >= 3

  /* ---- Story start ---- */
  const handleStartStory = useCallback(async () => {
    if (!storyTask.trim()) return
    if (story.connectionState === 'connecting' || story.connectionState === 'streaming') return
    setError(null)
    try {
      await story.startStory(storyTask, selectedCharId, getVoiceExample(selectedCharId, relation) ?? null)
      setStoryTask('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [storyTask, story, selectedCharId, relation])

  /* ---- Auto-play mode (triggered by landing screen) ---- */
  const handleEnterWorld = useCallback(() => {
    setHasEnteredWorld(true)
    setAutoPlayMode(true)
  }, [setHasEnteredWorld])

  useEffect(() => {
    if (!autoPlayMode) return
    const timer = setTimeout(async () => {
      setAutoPlayMode(false)
      setStoryTask(DEFAULT_STORY_PROMPT)
      setView('story')
      setError(null)
      try {
        await story.startStory(DEFAULT_STORY_PROMPT, selectedCharId, getVoiceExample(selectedCharId, relation) ?? null)
        setStoryTask('')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [autoPlayMode, story, selectedCharId, relation, setView])

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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: selectedCharId,
          userInput: userText,
          relation,
          mode,
          history: nextHistory.slice(-10).map(m => ({ sender: m.sender, text: m.text })),
          language,
          llmProvider,
          voiceExample: getVoiceExample(selectedCharId, relation) ?? null,
          memorySummary: updatedAfterUser.summary || undefined,
          keyFacts: updatedAfterUser.keyFacts.length > 0 ? updatedAfterUser.keyFacts : undefined,
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ error: 'Server error' }))
        throw new Error(detail.error || detail.detail || 'Chat failed')
      }
      const data = await res.json()

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
  }, [message, isSending, messages, selectedCharId, relation, mode, language, llmProvider, updateMessages, auth, currentMemory, charMemory, setMemoryByChar, cloudPrivacy.key])

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
    setAutoPlayMode(false)
  }, [story, setHasEnteredWorld])

  const storyContextSummary = useMemo(() => {
    const spoken = story.events
      .filter(evt => evt.type === 'agent_speak')
      .slice(-4)
      .map(evt => `${evt.data.character_id ?? 'Character'}: ${evt.data.content ?? ''}`)
      .join('\n')
    return [story.outline, spoken].filter(Boolean).join('\n\n')
  }, [story.events, story.outline])

  const handleContinueChapter = useCallback(async () => {
    const prompt = `${DEFAULT_STORY_PROMPT}\n\nContinue this as Chapter 2. Keep the consequences of Chapter 1 intact, raise the pressure, and do not restart the story.\n\nChapter 1 context:\n${storyContextSummary || 'No previous context was captured.'}`
    await story.startStory(prompt, selectedCharId, getVoiceExample(selectedCharId, relation) ?? null)
  }, [relation, selectedCharId, story, storyContextSummary])

  const handleBranchStory = useCallback(async () => {
    const prompt = `${DEFAULT_STORY_PROMPT}\n\nBranch from the earlier decisive beat. Preserve the setup, then take the plot in a sharply different direction chosen by character conflict rather than coincidence.\n\nOriginal context:\n${storyContextSummary || 'No previous context was captured.'}`
    await story.startStory(prompt, selectedCharId, getVoiceExample(selectedCharId, relation) ?? null)
  }, [relation, selectedCharId, story, storyContextSummary])

  const handleReplayBeat = useCallback(async () => {
    const prompt = `${DEFAULT_STORY_PROMPT}\n\nReplay the last beat from a more intimate angle. Keep the same premise, but reveal a hidden motive or unspoken fear that was not explicit before.\n\nPrevious context:\n${storyContextSummary || 'No previous context was captured.'}`
    await story.startStory(prompt, selectedCharId, getVoiceExample(selectedCharId, relation) ?? null)
  }, [relation, selectedCharId, story, storyContextSummary])

  /* ---- Render ---- */
  if (!hasEnteredWorld) {
    return (
      <div className="landing-screen">
        <div className="landing-screen__content">
          <h1 className="landing-screen__title">
            BREAKING BAD
            <span className="landing-screen__title-accent">World Lines</span>
          </h1>
          <p className="landing-screen__description">{t.landingSubtitle}</p>
          <div className="landing-screen__divider" />
          <div className="landing-screen__steps">
            <div className="landing-step">
              <span className="landing-step__num">1</span>
              <span className="landing-step__label">{t.landingStep1}</span>
            </div>
            <div className="landing-screen__step-arrow">&rsaquo;</div>
            <div className="landing-step">
              <span className="landing-step__num">2</span>
              <span className="landing-step__label">{t.landingStep2}</span>
            </div>
            <div className="landing-screen__step-arrow">&rsaquo;</div>
            <div className="landing-step">
              <span className="landing-step__num">3</span>
              <span className="landing-step__label">{t.landingStep3}</span>
            </div>
          </div>
          <button className="landing-screen__enter" onClick={handleEnterWorld} type="button">
            {t.enterWorld}
            <span className="landing-screen__enter-arrow">&rarr;</span>
          </button>
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
      <main className="app-shell">
      {/* ===================== SIDEBAR ===================== */}
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

        {/* Model backend — hidden, backend uses cliproxy default */}
      </aside>

      {/* ===================== MAIN PANEL ===================== */}
      {view === 'story' ? (
        /* ---------- Story View ---------- */
        <section className="story-panel">
          <header className="story-header">
            <h2>{t.narrativeStream}</h2>
            <span className="schema-pill">
              {story.connectionState === 'idle' && t.setStage}
              {story.connectionState === 'connecting' && t.connecting}
              {story.connectionState === 'streaming' && t.streaming}
              {story.connectionState === 'beat_paused' && t.paused}
              {story.connectionState === 'complete' && t.eventComplete}
              {story.connectionState === 'error' && t.eventError}
            </span>
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
            <div className="story-stream">
              {story.outline && (
                <div className="story-outline">
                  <strong>{t.storyOutline}</strong>
                  <p>{story.outline}</p>
                </div>
              )}

              <div className="story-progress">
                <span>Beat {story.beatIndex}</span>
              </div>

              <div className="story-events">
                {story.events.map((evt, i) => (
                  <div key={`${i}-${evt.type}-${evt.received_at ?? ''}`} className={`story-event story-event--${evt.type}`}>
                    <strong>{getEventTitle(evt, language)}</strong>
                    <div className="event-body">
                      {evt.type === 'scene_change' && (
                        <p>{(evt.data.description as string) ?? ''}</p>
                      )}
                      {evt.type === 'agent_speak' && (() => {
                        const speakCharId = DISPLAY_NAME_TO_ID[evt.data.character_id as string]
                        const speakText = (evt.data.content as string) ?? ''
                        return (
                          <div className="story-event__content">
                            <p><em>{(evt.data.character_id as string) ?? ''}:</em> {speakText}</p>
                            {speakCharId && speakText && (
                              <VoicePlayer
                                text={speakText}
                                characterId={speakCharId}
                                language={language}
                              />
                            )}
                            <GifCard src={resolveStoryEventGif(evt)} alt={(evt.data.gif_search_query as string) ?? ''} />
                          </div>
                        )
                      })()}
                      {evt.type === 'agent_think' && (
                        <p className="thought"><em>{(evt.data.character_id as string) ?? ''}:</em> {(evt.data.thought_content as string) ?? ''}</p>
                      )}
                      {evt.type === 'agent_act' && (
                        <p><em>{(evt.data.character_id as string) ?? ''}</em> {(evt.data.action as string) ?? ''}</p>
                      )}
                      {evt.type === 'world_state_delta' && (
                        <ul className="world-delta">
                          {(evt.data.deltas as Array<Record<string, string>> | undefined)?.map((d, j) => (
                            <li key={j}>
                              {d.target ?? d.entity}: {d.field} {d.old_value ?? '∅'} → {d.new_value ?? '∅'}
                            </li>
                          ))}
                        </ul>
                      )}
                      {evt.type === 'status' && (
                        <p className="status-msg">{evt.data.message as string}</p>
                      )}
                      {evt.type === 'complete' && (
                        <p>{(evt.data.message as string) ?? t.storyComplete}</p>
                      )}
                      {evt.type === 'error' && (
                        <p className="status-msg">⚠ {(evt.data.message as string) ?? 'Error'}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

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

              {/* beat_paused: decision controls */}
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

              {/* complete: restart and follow-up entries.
                  Each new-session button seeds the next story with the
                  recent context so the user feels like they are picking up
                  where the last chapter left off. The buttons are labelled
                  "Start Again" rather than "Continue" so users do not
                  expect an in-band continuation of the closed session. */}
              {story.connectionState === 'complete' && (
                <div className="story-complete">
                  <p>🎬 {t.storyComplete}</p>
                  <div className="story-complete__actions">
                    <button type="button" onClick={handleContinueChapter}>{t.continueChapter}</button>
                    <button type="button" onClick={handleBranchStory}>{t.branchStory}</button>
                    <button type="button" onClick={handleReplayBeat}>{t.replayBeat}</button>
                    <button type="button" onClick={story.reset}>{t.startAgain}</button>
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

          <div className="chat-stream">
            {messages.map(msg => {
              const isUser = msg.sender === 'user'
              const senderChar = isUser ? null : characters.find(c => c.id === msg.sender)
              const senderName = senderChar?.name ?? (isUser ? t.you : (msg.sender as string))
              const senderColor = senderChar?.color ?? selectedChar.color
              return (
                <article key={msg.id} className={`msg ${isUser ? 'msg--user' : 'msg--char'}`}>
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
                        <span>Tool: <code>{msg.toolExecuted}</code></span>
                        {msg.toolLog && <p>{msg.toolLog}</p>}
                      </div>
                    )}
                    {msg.id.startsWith('opener-') && msg.sender !== 'user' && (
                      <VoicePlayer text={msg.text} characterId={msg.sender as CharacterId} language={language} />
                    )}
                    <GifCard src={msg.gifUrl} alt={msg.gifQuery ?? ''} caption={msg.gifQuery ? `${t.gifTrigger}: ${msg.gifQuery}` : undefined} />
                  </div>
                </article>
              )
            })}
          </div>

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
        </section>
      )}
    </main>
    </>
  )
}

export default App
