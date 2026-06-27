import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Silhouette } from './lib/silhouette'
import { usePersistedState } from './lib/persistedState'
import { getVoiceExample } from './lib/voiceExamples'
import { useStoryStream, type StoryEvent } from './hooks/useStoryStream'
import { useCharacterMemory, type CharacterMemory } from './hooks/useCharacterMemory'
import { useAuth } from './hooks/useAuth'
import { loadChatMessages, loadCharacterMemory, persistChatMessage, persistCharacterMemory } from './lib/supabasePersistence'
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
  switch (evt.type) {
    case 'outline': return lang === 'zh' ? '故事大纲' : 'Story Outline'
    case 'scene_change': return lang === 'zh' ? '场景切换' : 'Scene Change'
    case 'agent_speak': return lang === 'zh' ? `${charId} 说` : `${charId} speaks`
    case 'agent_think': return lang === 'zh' ? `${charId} 思考` : `${charId} thinks`
    case 'agent_act': return lang === 'zh' ? `${charId} 行动` : `${charId} acts`
    case 'beat_ready': return lang === 'zh' ? '🎬 导演等你决策' : '🎬 Director awaits your decision'
    case 'world_state_delta': return lang === 'zh' ? '📊 世界状态变化' : '📊 World State Delta'
    case 'status': return lang === 'zh' ? '状态更新' : 'Status'
    case 'complete': return lang === 'zh' ? '🎬 剧情完结' : '🎬 Story Complete'
    case 'error': return lang === 'zh' ? '⚠ 错误' : '⚠ Error'
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
  relationOptions: string[]
  opener: Record<Language, string>
}

/* ------------------------------------------------------------------ */
/*  Static data                                                       */
/* ------------------------------------------------------------------ */

const characters: Character[] = [
  {
    id: 'walter', name: 'Walter', color: '#d7e36f',
    relationOptions: ['former student', 'family member', 'lab partner', 'DEA liability', 'old colleague'],
    opener: { en: 'Choose your words carefully. The situation is already more delicate than you understand.', zh: '说话谨慎一点。这个局面已经比你理解的更微妙。' },
  },
  {
    id: 'jesse', name: 'Jesse', color: '#93d7ff',
    relationOptions: ['partner', 'old friend', 'dealer contact', 'younger sibling figure', 'person he disappointed'],
    opener: { en: 'Yo, if this is another lecture, I need like five seconds to emotionally leave the room first.', zh: 'Yo，如果这又是一场说教，我需要五秒钟先从精神上离开这个房间。' },
  },
  {
    id: 'skyler', name: 'Skyler', color: '#f3d9a2',
    relationOptions: ['spouse', 'family member', 'bookkeeping client', 'neighbor', 'person hiding something'],
    opener: { en: 'I am going to ask this once plainly, and I would appreciate a plain answer.', zh: '我只会直说一次，也希望你给我一个直白的答案。' },
  },
  {
    id: 'saul', name: 'Saul', color: '#f7ce46',
    relationOptions: ['client', 'witness', 'business partner', 'problem to solve', 'person with cash'],
    opener: { en: 'Good news: you came to the right office. Bad news: that usually means something went very wrong.', zh: '好消息是：你找对办公室了。坏消息是：这通常说明事情已经非常不对劲。' },
  },
  {
    id: 'mike', name: 'Mike', color: '#b9c0a5',
    relationOptions: ['asset', 'employer', 'person under protection', 'loose end', 'rookie'],
    opener: { en: 'Sit down. Talk less. Start with the part you think I do not already know.', zh: '坐下。少说废话。从你以为我还不知道的部分开始。' },
  },
  {
    id: 'gus', name: 'Gus', color: '#b2f09a',
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

const uiText = {
  en: {
    tagline: 'Stateful Breaking Bad autonomous agents running Plan-Reflect cognitive loops.',
    character: 'Active Profile',
    language: 'Language',
    relation: 'Relation',
    view: 'View',
    chat: 'Chat',
    story: 'Story',
    perspective: 'Perspective',
    global: 'Global',
    inCharacter: 'In-Character',
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
  },
  zh: {
    tagline: '《绝命毒师》微观智能体引擎，后台 Plan-Reflect 认知循环与文件记忆库。',
    character: '主控角色',
    language: '语言',
    relation: '关系锚点',
    view: '视图',
    chat: '对话',
    story: '剧情',
    perspective: '叙事视角',
    global: '全局 导演',
    inCharacter: '扮演 入戏',
    mode: '模式',
    direct: '微观私聊',
    crew: '宏观辩论',
    model: '模型后端',
    storyTitle: 'ABQ Roleplay Lab',
    setStage: '布置任务',
    setStageHint: '用一段自然语言描述你想要的故事走向。Agent 将自主演绎剧情，每个节点停下来等你决策。',
    placeholder: '例如：Walter White 需要想办法从 Gus Fring 那里拿到新的甲胺供应，同时不能让 Skyler 发现…',
    startStory: '开始剧情',
    directing: '正在编排…',
    narrativeStream: '剧情流',
    eventFeed: '细粒度事件驱动叙事',
    directorDecision: '导演等待你的决策：',
    switchToChat: '切换到对话',
    you: '你',
    send: '发送',
    sending: '深度思考中…',
    messagePlaceholder: '以 {relation} 的身份向 {character} 展开对话…',
    privateScene: '私密拉扯场景',
    crewScene: '多人剧情辩论',
    schema: 'Director 驱动',
    gifTrigger: 'GIF 触发',
    connected: '剧情流在线',
    connecting: '连接中…',
    disconnected: '已断开',
    storyComplete: '剧情结束。所有 beat 已渲染。',
    continue: '继续',
    stop: '停止',
    storyOutline: '故事大纲',
    paused: '已暂停',
  },
} satisfies Record<Language, Record<string, string>>

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
  language: Language
  characters: Character[]
  onContinue: () => void | Promise<void>
  onStop: () => void | Promise<void>
  onRedirect: (prompt: string) => void | Promise<void>
  onSwitchPerspective: (charId: string) => void | Promise<void>
}

function BeatControls({ t, language, characters, onContinue, onStop, onRedirect, onSwitchPerspective }: BeatControlsProps) {
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

  const zh = language === 'zh'
  const labels = {
    redirect: zh ? '↩ 重定向' : '↩ Redirect',
    switchPerspective: zh ? '👤 切换视角' : '👤 Switch Perspective',
    submit: zh ? '提交' : 'Submit',
    cancel: zh ? '取消' : 'Cancel',
    selectCharacter: zh ? '选择角色…' : 'Select character…',
    redirectPlaceholder: zh ? '输入新的剧情方向…' : 'Enter new plot direction…',
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

/* ------------------------------------------------------------------ */
/*  App                                                               */
/* ------------------------------------------------------------------ */

function App() {
  const [selectedCharId, setSelectedCharId] = usePersistedState<CharacterId>('character', 'walter')
  const selectedChar = characters.find(c => c.id === selectedCharId) ?? characters[0]
  const [language, setLanguage] = usePersistedState<Language>('language', 'zh')
  const t = uiText[language]

  // Relation per character (persist across character switches)
  const [relationByChar, setRelationByChar] = usePersistedState<Record<string, string>>('relation', {})
  const relation = relationByChar[selectedCharId] ?? selectedChar.relationOptions[0]

  const [view, setView] = usePersistedState<View>('view', 'chat')
  const [mode, setMode] = usePersistedState<ChatMode>('mode', 'direct')
  const [llmProvider, setLlmProvider] = usePersistedState<string>('llm', 'stepfun')

  // Chat state
  const [messagesByChar, setMessagesByChar] = usePersistedState<Record<string, ChatMessage[]>>('messages', {})
  const messages = messagesByChar[selectedCharId] ?? []
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auth state
  const auth = useAuth()

  // Story state
  const story = useStoryStream()
  const [storyTask, setStoryTask] = useState('')

  // Character memory (per character, sliding window)
  const charMemory = useCharacterMemory()
  const [memoryByChar, setMemoryByChar] = usePersistedState<Record<string, CharacterMemory>>('memory', {})
  const currentMemory = memoryByChar[selectedCharId] ?? { summary: '', keyFacts: [] }

  // Cloud sync: persist to Supabase when authenticated
  const [syncStatus, setSyncStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!auth.user) {
      setSyncStatus(null)
      return
    }
    // Load cloud messages + memory on login
    ;(async () => {
      try {
        const [msgs, mem] = await Promise.all([
          loadChatMessages(auth.user!.id, selectedCharId),
          loadCharacterMemory(auth.user!.id, selectedCharId),
        ])
        if (msgs.length > 0) {
          setMessagesByChar(prev => ({ ...prev, [selectedCharId]: msgs as ChatMessage[] }))
        }
        if (mem) {
          setMemoryByChar(prev => ({ ...prev, [selectedCharId]: mem as unknown as CharacterMemory }))
        }
        setSyncStatus('synced')
      } catch (e) {
        setSyncStatus('sync-failed')
      }
    })()
  }, [auth.user, selectedCharId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- First-visit opener ---- */
  useEffect(() => {
    if (!messagesByChar[selectedCharId]) {
      const opener = getVoiceExample(selectedCharId, relation) ?? selectedChar.opener[language]
      const openerGif = resolveGifUrl(selectedCharId, 'opening pressure', null)
      setMessagesByChar(prev => ({
        ...prev,
        [selectedCharId]: [{
          id: `opener-${selectedCharId}`,
          sender: selectedCharId,
          text: opener,
          emotion: language === 'zh' ? '开场压迫' : 'opening pressure',
          gifQuery: null,
          gifUrl: openerGif,
        }],
      }))
    }
  }, [selectedCharId, language]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Scene background cross-fade (chat view) ---- */
  const [currentSceneUrl, setCurrentSceneUrl] = useState<string>(pickSceneUrl([]))
  const [prevSceneUrl, setPrevSceneUrl] = useState<string | null>(null)
  const [sceneReady, setSceneReady] = useState(false)

  useEffect(() => {
    const next = pickSceneUrl(messages.slice(-8).map(m => m.text))
    if (next !== currentSceneUrl) {
      setSceneReady(false)
      setPrevSceneUrl(currentSceneUrl)
      setCurrentSceneUrl(next)
    }
  }, [messages])

  useEffect(() => {
    const id = setTimeout(() => setSceneReady(true), 50)
    return () => clearTimeout(id)
  }, [currentSceneUrl])

  const userTurnCount = messages.filter(m => m.sender === 'user').length
  const showSavePrompt = !auth.user && userTurnCount >= 3

  /* ---- Story start ---- */
  const handleStartStory = useCallback(async () => {
    if (!storyTask.trim()) return
    if (story.connectionState === 'connecting' || story.connectionState === 'streaming') return
    setError(null)
    try {
      await story.startStory(storyTask, selectedCharId)
      setStoryTask('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [storyTask, story, selectedCharId])

  /* ---- Chat send ---- */
  const updateMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessagesByChar(prev => ({
      ...prev,
      [selectedCharId]: updater(prev[selectedCharId] ?? []),
    }))
  }, [selectedCharId])

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
    updateMessages(() => nextHistory)
    setMessage('')
    setIsSending(true)
    setError(null)

    // Update memory with user turn
    const updatedAfterUser = charMemory.addTurn('user', userText, currentMemory)

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
        const finalMemory = charMemory.addTurn(selectedCharId, reply.text, updatedAfterUser)
        setMemoryByChar(prev => ({ ...prev, [selectedCharId]: finalMemory }))

        // Persist to Supabase if authenticated
        if (auth.user) {
          persistChatMessage(auth.user.id, {
            character_id: selectedCharId,
            message: reply.text,
            sender: selectedCharId,
            emotion: reply.emotion ?? null,
          }).catch(() => {})
          persistCharacterMemory(auth.user.id, {
            character_id: selectedCharId,
            summary: finalMemory.summary,
            key_facts: finalMemory.keyFacts as unknown as Array<Record<string, unknown>>,
          }).catch(() => {})
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsSending(false)
    }
  }, [message, isSending, messages, selectedCharId, relation, mode, language, llmProvider, updateMessages])

  /* ---- Character change ---- */
  const handleCharChange = useCallback((id: CharacterId) => {
    setSelectedCharId(id)
    setRelationByChar(prev => ({ ...prev, [id]: characters.find(c => c.id === id)!.relationOptions[0] }))
    setMessage('')
    setError(null)
  }, [setSelectedCharId, setRelationByChar])

  /* ---- Render ---- */
  return (
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
              >
                <Silhouette characterId={c.id} name={c.name} size={30} />
                <strong>{c.name}</strong>
              </button>
            ))}
          </div>
        </section>

        {/* Language */}
        <section>
          <span className="field-label">{t.language}</span>
          <div className="seg-control">
            <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button>
            <button className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>中文</button>
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

        {/* Perspective (story only) */}
        {view === 'story' && (
          <section>
            <span className="field-label">{t.perspective}</span>
            <div className="seg-control">
              <button className="active">{t.global}</button>
            </div>
          </section>
        )}

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

        {/* Model backend */}
        <section>
          <label htmlFor="llmProvider">{t.model}</label>
          <select id="llmProvider" value={llmProvider} onChange={e => setLlmProvider(e.target.value)}>
            <option value="agnes">Agnes AI (free)</option>
            <option value="stepfun">StepFun step-3.7-flash</option>
            <option value="deepseek">DeepSeek</option>
            <option value="minimax">MiniMax</option>
          </select>
        </section>
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
              {story.connectionState === 'streaming' && (language === 'zh' ? '播放中' : 'Streaming')}
              {story.connectionState === 'beat_paused' && t.paused}
              {story.connectionState === 'complete' && (language === 'zh' ? '已完结' : 'Complete')}
              {story.connectionState === 'error' && (language === 'zh' ? '错误' : 'Error')}
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
              <p>{t.directing}</p>
            </div>
          )}

          {/* Error */}
          {story.connectionState === 'error' && (
            <div className="story-error">
              <p>⚠ {story.error}</p>
              {story.sessionId && (
                <button type="button" onClick={story.reconnect}>
                  {language === 'zh' ? '重连' : 'Reconnect'}
                </button>
              )}
              <button type="button" onClick={story.reset}>
                {language === 'zh' ? '重新开始' : 'Restart'}
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
                      {language === 'zh' ? '导演 5 分钟无操作，自动继续中…' : 'Director auto-continuing (5min idle)…'}
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
                    language={language}
                    characters={characters}
                    onContinue={() => story.sendAction('continue')}
                    onStop={() => story.sendAction('stop')}
                    onRedirect={(prompt) => story.sendAction('redirect', { redirect_prompt: prompt })}
                    onSwitchPerspective={(charId) => story.sendAction('switch_perspective', { target_character: charId })}
                  />
                </div>
              )}

              {/* complete: restart entry */}
              {story.connectionState === 'complete' && (
                <div className="story-complete">
                  <p>🎬 {t.storyComplete}</p>
                  <button type="button" onClick={story.reset}>{t.startStory}</button>
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
                {language === 'zh'
                  ? `${selectedChar.name} 与其${getRelationLabel(relation, language)}`
                  : `${selectedChar.name} with their ${getRelationLabel(relation, language)}`}
              </h2>
              {showSavePrompt && (
                <div className="save-prompt">
                  {language === 'zh'
                    ? '登录以保存这段对话到云端。'
                    : 'Sign in to save this conversation to the cloud.'}
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
  )
}

export default App
