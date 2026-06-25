import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Silhouette } from './lib/silhouette'
import { usePersistedState } from './lib/persistedState'
import { getVoiceExample } from './lib/voiceExamples'
import { useStoryStream } from './hooks/useStoryStream'
import { pickSceneUrl } from './lib/sceneBackgrounds'
import StoryPanel from './components/StoryPanel'
import './App.css'

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type ChatMode = 'direct' | 'crew'
type Language = 'en' | 'zh'
type View = 'chat' | 'story'

type CharacterId = 'walter' | 'jesse' | 'skyler' | 'saul' | 'mike' | 'gus'

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
/*  App                                                               */
/* ------------------------------------------------------------------ */

function App() {
  const [selectedCharId, setSelectedCharId] = usePersistedState<CharacterId>('abq_character', 'walter')
  const selectedChar = characters.find(c => c.id === selectedCharId) ?? characters[0]
  const [language, setLanguage] = usePersistedState<Language>('abq_language', 'zh')
  const t = uiText[language]

  // Relation per character (persist across character switches)
  const [relationByChar, setRelationByChar] = usePersistedState<Record<string, string>>('abq_relation', {})
  const relation = relationByChar[selectedCharId] ?? selectedChar.relationOptions[0]

  const [view, setView] = usePersistedState<View>('abq_view', 'chat')
  const [mode, setMode] = usePersistedState<ChatMode>('abq_mode', 'direct')
  const [llmProvider, setLlmProvider] = usePersistedState<string>('abq_llm', 'stepfun')

  // Chat state
  const [messagesByChar, setMessagesByChar] = usePersistedState<Record<string, ChatMessage[]>>('abq_messages', {})
  const messages = messagesByChar[selectedCharId] ?? []
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Story state
  const [storySessionId, setStorySessionId] = useState<string | null>(null)
  const [storyTask, setStoryTask] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  /* ---- First-visit opener ---- */
  useEffect(() => {
    if (!messagesByChar[selectedCharId]) {
      const opener = getVoiceExample(selectedCharId, relation) ?? selectedChar.opener[language]
      setMessagesByChar(prev => ({
        ...prev,
        [selectedCharId]: [{
          id: `opener-${selectedCharId}`,
          sender: selectedCharId,
          text: opener,
          emotion: language === 'zh' ? '开场压迫' : 'opening pressure',
          gifQuery: null,
          gifUrl: null,
        }],
      }))
    }
  }, [selectedCharId, language]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Scene background (chat view) ---- */
  const sceneStyle = useMemo<CSSProperties>(() => {
    const recentTexts = messages.slice(-8).map(m => m.text)
    return {
      backgroundImage: `url(${pickSceneUrl(recentTexts)})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    }
  }, [messages])

  /* ---- Story stream hook ---- */
  const streamUrl = storySessionId ? `/api/session/${storySessionId}/stream` : ''
  const storyStream = useStoryStream({ url: streamUrl })

  /* ---- Session creation ---- */
  const handleCreateSession = useCallback(async () => {
    if (!storyTask.trim() || isCreating) return
    setIsCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: storyTask.slice(0, 60),
          task_prompt: storyTask,
          active_character_id: selectedCharId,
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(detail.error || detail.detail || 'Session creation failed')
      }
      const data = await res.json()
      setStorySessionId(data.session_id)
      setStoryTask('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsCreating(false)
    }
  }, [storyTask, isCreating, selectedCharId])

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
            debateReplies.push({
              id: crypto.randomUUID(),
              sender: log.sender as CharacterId,
              text: log.text as string,
              emotion: log.emotion as string | undefined,
              gifQuery: log.gifQuery as string | null,
              gifUrl: null,
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
          gifUrl: null,
          thinking: data.thinking,
          toolExecuted: data.tool_executed,
          toolLog: data.tool_log,
        }
        updateMessages(current => [...current, reply])
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
            <option value="stepfun">StepFun step-3.7-flash</option>
          </select>
        </section>
      </aside>

      {/* ===================== MAIN PANEL ===================== */}
      {view === 'story' ? (
        /* ---------- Story View ---------- */
        <section className="story-panel">
          {!storySessionId ? (
            <div className="story-setup">
              <h2>{t.setStage}</h2>
              <p>{t.setStageHint}</p>
              <textarea
                value={storyTask}
                onChange={e => setStoryTask(e.target.value)}
                placeholder={t.placeholder}
              />
              <button
                type="button"
                onClick={handleCreateSession}
                disabled={!storyTask.trim() || isCreating}
              >
                {isCreating ? t.directing : t.startStory}
              </button>
              {error && <div className="error-box">{error}</div>}
            </div>
          ) : (
            <StoryPanel
              view="story"
              stream={storyStream}
              onSwitchToChat={() => setView('chat')}
              title={t.narrativeStream}
              subtitle={t.eventFeed}
              beatPrompt={t.directorDecision}
              chatBtnLabel={t.switchToChat}
              language={language}
            />
          )}
        </section>
      ) : (
        /* ---------- Chat View ---------- */
        <section className="chat-panel" style={sceneStyle}>
          <header className="chat-header">
            <div>
              <p>{mode === 'crew' ? t.crewScene : t.privateScene}</p>
              <h2>
                {language === 'zh'
                  ? `${selectedChar.name} 与其${getRelationLabel(relation, language)}`
                  : `${selectedChar.name} with their ${getRelationLabel(relation, language)}`}
              </h2>
            </div>
            <span className="schema-pill">{t.schema}</span>
          </header>

          <div className="chat-stream">
            {messages.map(msg => {
              const isUser = msg.sender === 'user'
              return (
                <article key={msg.id} className={`msg ${isUser ? 'msg--user' : 'msg--char'}`}>
                  <div className="msg-avatar" style={{ '--char-color': isUser ? 'var(--color-bb-yellow)' : selectedChar.color } as CSSProperties}>
                    {isUser ? <span className="avatar-letter">{t.you[0]}</span> : <Silhouette characterId={msg.sender as CharacterId} name={selectedChar.name} size={36} />}
                  </div>
                  <div className="msg-body">
                    <div className="msg-meta">
                      <strong>{isUser ? `${t.you}, ${getRelationLabel(relation, language)}` : selectedChar.name}</strong>
                      {msg.emotion && <span>{msg.emotion}</span>}
                    </div>
                    <p>{msg.text}</p>
                    {msg.toolExecuted && (
                      <div className="tool-pill">
                        <span>Tool: <code>{msg.toolExecuted}</code></span>
                        {msg.toolLog && <p>{msg.toolLog}</p>}
                      </div>
                    )}
                    {msg.gifUrl && (
                      <figure className="gif-card">
                        <img src={msg.gifUrl} alt={msg.gifQuery ?? ''} onError={e => e.currentTarget.closest('figure')?.setAttribute('hidden', 'true')} />
                        <figcaption>{t.gifTrigger}: {msg.gifQuery}</figcaption>
                      </figure>
                    )}
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
