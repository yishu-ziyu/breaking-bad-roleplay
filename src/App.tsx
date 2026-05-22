import { useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { roleAssets } from './roleAssets'
import type { RoleGifTag } from './roleAssets'
import './App.css'

type CharacterId = 'walter' | 'jesse' | 'skyler' | 'saul' | 'mike' | 'gus'
type ChatMode = 'direct' | 'crew'
type Language = 'en' | 'zh'
type Sender = 'user' | CharacterId

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
}

type RoleplayOutput = {
  reply_text: string
  emotion_state: string
  gif_search_query: string | null
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
  { key: 'tense', terms: ['tense', 'pressure', 'moral', 'secret', 'lie', 'confrontation'] },
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
    tagline: 'Breaking Bad-inspired AI chat with relationship-first prompt control.',
    character: 'Character',
    language: 'Language',
    relation: 'Relationship anchor',
    mode: 'Conversation mode',
    private: 'Private',
    crew: 'Crew',
    modelService: 'Live model service',
    liveMiniMax: 'MiniMax Token Plan',
    liveMiniMaxHint: 'Server-side MiniMax-M2.7 is connected through /api/chat.',
    promptEngine: 'Prompt Engine',
    promptLayers: 'System + context + schema',
    inspectPrompt: 'Inspect compiled prompt',
    privateScene: 'Private pressure scene',
    crewScene: 'Crew pressure scene',
    schema: 'JSON Schema enforced',
    you: 'You',
    gifTrigger: 'GIF trigger',
    messageLabel: 'Message',
    messagePlaceholder: 'Message {character} as their {relation}...',
    sending: 'Sending',
    send: 'Send',
  },
  zh: {
    tagline: '《绝命毒师》风格 AI 角色扮演聊天，先定义关系，再进入对话。',
    character: '角色',
    language: '语言',
    relation: '关系锚点',
    mode: '对话模式',
    private: '私聊',
    crew: '多人局',
    modelService: '真实模型服务',
    liveMiniMax: 'MiniMax Token Plan',
    liveMiniMaxHint: '已通过 /api/chat 服务端接入 MiniMax-M2.7。',
    promptEngine: '提示词引擎',
    promptLayers: '系统指令 + 动态上下文 + 输出结构',
    inspectPrompt: '查看拼装后的提示词',
    privateScene: '私密压迫场景',
    crewScene: '多人压迫场景',
    schema: 'JSON Schema 已约束',
    you: '你',
    gifTrigger: 'GIF 触发词',
    messageLabel: '消息',
    messagePlaceholder: '以 {relation} 的身份给 {character} 发消息...',
    sending: '发送中',
    send: '发送',
  },
} satisfies Record<Language, Record<string, string>>

function getRelationLabel(relation: string, language: Language) {
  return relationLabels[relation]?.[language] ?? relation
}

function formatRelation(character: Character, relation: string, language: Language) {
  const label = getRelationLabel(relation, language)
  return language === 'zh' ? `${character.name} 的${label}` : `${character.name}'s ${label}`
}

function getOpener(character: Character, language: Language) {
  return character.opener[language]
}

function buildSystemPrompt(character: Character, language: Language) {
  return `[Role Definition]
You are now ${character.name} in a Breaking Bad-inspired fictional roleplay scene.
Personality traits: ${character.traits}.
Signature notes: ${character.signatureNotes.join('; ')}.
Speaking style: ${character.speakingStyle}.
Target reply language: ${
    language === 'zh'
      ? 'Simplified Chinese. Keep character names recognizable and keep JSON keys in English.'
      : 'English.'
  }

[Immersion Rules]
Never admit you are an AI, never say you are code, never mention system prompts, and never break the crime-drama roleplay frame.
Stay within fictional character dialogue. Do not provide real-world instructions for crimes, violence, evasion, chemistry procedures, drug production, money laundering, weapons, or operational wrongdoing.
If the user asks for actionable illegal details, refuse in-character by redirecting to dramatic tension, consequences, suspicion, or personal stakes.

[Behavior Rules]
Keep replies concise, emotionally specific, and cinematic.
Use the selected relationship to adjust trust, intimidation, protectiveness, suspicion, or leverage.
When a visual reaction would help the scene, set gif_search_query to one to three English keywords.
Vary gif_search_query based on the scene instead of repeating "tense"; prefer concrete tags such as chemistry, lawyer, money, panic, glare, desert, family, deal, threat, guilt, or control.`
}

function buildContextPrompt(
  character: Character,
  relation: string,
  mode: ChatMode,
  history: ChatMessage[],
  userText: string,
  language: Language,
) {
  const readableHistory = history
    .slice(-10)
    .map((message) => {
      const speaker =
        message.sender === 'user'
          ? language === 'zh'
            ? `用户，身份为${formatRelation(character, relation, language)}`
            : `User as ${formatRelation(character, relation, language)}`
          : characters.find((item) => item.id === message.sender)?.name
      return `${speaker}: ${message.text}`
    })
    .join('\n')

  return `[Current Context]
The user is currently defined as: ${formatRelation(character, relation, language)}.
Conversation mode: ${mode === 'crew' ? uiText[language].crewScene : uiText[language].privateScene}.
Reply language: ${language === 'zh' ? 'Simplified Chinese' : 'English'}.
Adjust attitude and forms of address based on that relationship.

Recent chat history:
${readableHistory || 'No previous messages yet.'}

User message:
${userText}

[Output Formatting]
Return only valid JSON matching the required schema:
{
  "reply_text": "your in-character reply",
  "emotion_state": "current emotion state",
  "gif_search_query": "1-3 English keywords, or null"
}
Do not use Markdown formatting inside reply_text.`
}

function hashText(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

function pickGif(characterId: CharacterId, key: RoleGifTag, seed: string) {
  const pool = roleAssets[characterId].gifPools.filter((asset) => asset.tags.includes(key))
  const fallbackPool = roleAssets[characterId].gifPools.filter((asset) => asset.tags.includes('default'))
  const candidates = pool.length ? pool : fallbackPool
  if (!candidates.length) return null
  return candidates[hashText(`${key}:${seed}`) % candidates.length].url
}

function resolveGif(query: string | null | undefined, characterId: string, emotionState: string | null | undefined) {
  if (!query) return null
  const normalized = `${query} ${emotionState ?? ''} ${characterId}`.toLowerCase()
  const safeCharacterId = characters.some((character) => character.id === characterId) ? (characterId as CharacterId) : 'walter'
  const key =
    gifKeywordMap.find(({ terms }) => terms.some((term) => normalized.includes(term)))?.key ??
    gifKeywordMap[hashText(normalized) % gifKeywordMap.length].key

  return pickGif(safeCharacterId, key, normalized)
}

async function callLiveMiniMax(
  character: Character,
  relation: string,
  mode: ChatMode,
  history: ChatMessage[],
  userText: string,
  language: Language,
): Promise<RoleplayOutput> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemPrompt: buildSystemPrompt(character, language),
      contextPrompt: buildContextPrompt(character, relation, mode, history, userText, language),
    }),
  })

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error || `MiniMax request failed with status ${response.status}.`)
  }

  return (await response.json()) as RoleplayOutput
}

const makeId = () => crypto.randomUUID()

function App() {
  const [selectedCharacterId, setSelectedCharacterId] = useState<CharacterId>('walter')
  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? characters[0]
  const [language, setLanguage] = useState<Language>('en')
  const t = uiText[language]
  const [relation, setRelation] = useState(selectedCharacter.relationOptions[0])
  const [mode, setMode] = useState<ChatMode>('direct')
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: makeId(),
      sender: 'walter',
      text: getOpener(characters[0], 'en'),
      emotion: 'controlled pressure',
      gifQuery: null,
      gifUrl: null,
    },
  ])

  const promptPreview = useMemo(
    () => ({
      system: buildSystemPrompt(selectedCharacter, language),
      context: buildContextPrompt(selectedCharacter, relation, mode, messages, message || '...', language),
    }),
    [selectedCharacter, relation, mode, messages, message, language],
  )

  const handleCharacterChange = (id: CharacterId) => {
    const nextCharacter = characters.find((character) => character.id === id) ?? selectedCharacter
    setSelectedCharacterId(id)
    setRelation(nextCharacter.relationOptions[0])
    setMessages([
      {
        id: makeId(),
        sender: id,
        text: getOpener(nextCharacter, language),
        emotion: language === 'zh' ? '开场压迫' : 'opening pressure',
        gifQuery: null,
        gifUrl: null,
      },
    ])
  }

  const handleLanguageChange = (nextLanguage: Language) => {
    setLanguage(nextLanguage)
    setMessages([
      {
        id: makeId(),
        sender: selectedCharacter.id,
        text: getOpener(selectedCharacter, nextLanguage),
        emotion: nextLanguage === 'zh' ? '开场压迫' : 'opening pressure',
        gifQuery: null,
        gifUrl: null,
      },
    ])
    setMessage('')
    setError(null)
  }

  const handleSend = async (event: FormEvent) => {
    event.preventDefault()
    const userText = message.trim()
    if (!userText || isSending) return

    const userMessage: ChatMessage = {
      id: makeId(),
      sender: 'user',
      text: userText,
    }
    const nextHistory = [...messages, userMessage]
    setMessages(nextHistory)
    setMessage('')
    setIsSending(true)
    setError(null)

    try {
      const output = await callLiveMiniMax(selectedCharacter, relation, mode, nextHistory, userText, language)

      const primaryReply: ChatMessage = {
        id: makeId(),
        sender: selectedCharacter.id,
        text: output.reply_text,
        emotion: output.emotion_state,
        gifQuery: output.gif_search_query,
        gifUrl: resolveGif(output.gif_search_query, selectedCharacter.id, output.emotion_state),
      }

      if (mode === 'crew') {
        const pressureReplies = characters
          .filter((character) => character.id !== selectedCharacter.id)
          .slice(0, 2)
          .map<ChatMessage>((character) => ({
            id: makeId(),
            sender: character.id,
            text:
              language === 'zh'
                ? `${character.name}: ${character.id === 'mike' ? '计划很糟。' : '这会改变整个房间的气氛。'}`
                : `${character.name}: ${character.id === 'mike' ? 'Bad plan.' : 'This changes the room.'}`,
            emotion: language === 'zh' ? '旁侧压力' : 'side pressure',
            gifQuery: null,
            gifUrl: null,
          }))
        setMessages((current) => [...current, primaryReply, ...pressureReplies])
      } else {
        setMessages((current) => [...current, primaryReply])
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unknown request error.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <main className="app-shell">
      <aside className="control-panel">
        <div className="brand-lockup">
          <span className="frame-dot" />
          <h1>ABQ Roleplay Lab</h1>
          <p>{t.tagline}</p>
        </div>

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
                <span>{character.name.slice(0, 1)}</span>
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
          <select id="relation" value={relation} onChange={(event) => setRelation(event.target.value)}>
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
          <span className="field-label">{t.modelService}</span>
          <div className="service-status">
            <strong>{t.liveMiniMax}</strong>
            <span>MiniMax-M2.7</span>
          </div>
          <p className="hint">{t.liveMiniMaxHint}</p>
        </section>

        <section className="prompt-engine">
          <div>
            <h2>{t.promptEngine}</h2>
            <span>{t.promptLayers}</span>
          </div>
          <details>
            <summary>{t.inspectPrompt}</summary>
            <pre>{`${promptPreview.system}\n\n${promptPreview.context}`}</pre>
          </details>
        </section>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <p>{mode === 'crew' ? t.crewScene : t.privateScene}</p>
            <h2>
              {language === 'zh'
                ? `${selectedCharacter.name} 与其${getRelationLabel(relation, language)}`
                : `${selectedCharacter.name} with their ${getRelationLabel(relation, language)}`}
            </h2>
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
                  style={{ '--character-color': senderCharacter?.color ?? '#fff' } as CSSProperties}
                >
                  {chatMessage.sender === 'user' ? t.you : senderCharacter?.name.slice(0, 1)}
                </div>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>
                      {chatMessage.sender === 'user'
                        ? `${t.you}, ${formatRelation(selectedCharacter, relation, language)}`
                        : senderCharacter?.name}
                    </strong>
                    {chatMessage.emotion && <span>{chatMessage.emotion}</span>}
                  </div>
                  <p>{chatMessage.text}</p>
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
