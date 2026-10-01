import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Silhouette } from './lib/silhouette'
import { usePersistedState } from './lib/persistedState'
import { chatThreadKey, mergeLegacyChat } from './lib/chatScope'
import { getVoiceExample } from './lib/voiceExamples'
import { useStoryStream, type StoryEvent } from './hooks/useStoryStream'
import { useCharacterMemory, type CharacterMemory } from './hooks/useCharacterMemory'
import { useAuth } from './hooks/useAuth'
import {
  loadChatMessages,
  loadCharacterMemory,
  persistPrivateCharacterMemory,
  persistPrivateChatMessages,
} from './lib/supabasePersistence'
import { loadStoredPrivacyKey, PRIVACY_KEY_UPDATED_EVENT } from './lib/privacyVault'
import { AuthSection } from './components/AuthSection'
import { GifCard } from './components/GifCard'
import { PlotGraphPanel } from './components/PlotGraphPanel'
import { AgentHarnessPanel } from './components/AgentHarnessPanel'
import { ColdOpenLanding, type ColdOpenStartPayload, type KnowledgeTrack } from './components/ColdOpenLanding'
import { StoryComingSoonNotice } from './components/StoryComingSoonNotice'
import {
  DramaDecisionBar,
  dramaSuggestionsForBeat,
  type DramaSuggestion,
} from './components/DramaDecisionBar'
import { StorySceneBillboard } from './components/StorySceneBillboard'
import { StoryFailureNotice } from './components/StoryFailureNotice'
import { StoryReadingSurface } from './components/StoryReadingSurface'
import { VoicePlayer } from './components/VoicePlayer'
import { ConnectionChip, ConnectionSheet } from './components/ConnectionSheet'
import { useConnection } from './hooks/useConnection'
import { useQuota, parseQuotaError } from './hooks/useQuota'
import { authHeaders } from './lib/authHeaders'
import { pickSceneUrl } from './lib/sceneBackgrounds'
import { ElementSquare } from './lib/ElementSquare'
import { applyPlaySurfaceToStorage } from './lib/playEntry'
import { canEnterStory, playModeBlocked, reclaimVisitorStorySurface, resolveAuthoringMode } from './lib/storyAvailability'
import { toDirectChatMemoryWire } from './lib/directChatMemory'
import { getDirectWayfinders, isInspectableThinking } from './lib/directWayfinders'
import { bubbleFromDirectPayload, bubblesFromCrewPayload } from './lib/directChatReply'
import { rewriteOpenerText, syncOpenerLanguage } from './lib/openerLanguage'
import {
  OPENERS_BY_CHARACTER,
  deriveAttitudeTint,
  pickDirectOpener,
} from './lib/directOpeners'
import {
  firstOpenThread,
  formatDurableMemoryForWire,
  type DurableFact,
} from './lib/directDurableMemory'
import { quotaBlocksPlay } from './lib/quotaPolicy'
import { buildStorySceneBill, holdsSceneCurtain } from './lib/storyScene'
import {
  buildReadingBlocks,
  canonicalBeatId,
  extractOnStageLore,
} from './lib/storyReading'
import { boundedStoryDirection } from './lib/storyCommands'
import './App.css'
import { HomePreview } from './components/HomePreview'
import './components/HomePreview.css'
import './components/ChatRefresh.css'
import { PlayModeBar, type PlayMode } from './components/PlayModeBar'

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

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** True while an IME candidate window is open — Enter confirms the candidate, not submit. */
function isImeComposing(e: ReactKeyboardEvent<HTMLElement>): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229
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
  nameZh: string
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
    id: 'walter', name: 'Walter', nameZh: '沃尔特', color: '#d7e36f',
    oneLiner: { en: 'A chemistry teacher turned empire builder. Precision, pride, and terrible secrets.', zh: '化学老师转型帝国建造者。精确、骄傲，和见不得人的秘密。' },
    relationOptions: ['family member', 'lab partner', 'former student', 'DEA liability'],
    opener: { en: 'Porch light keeps buzzing. Come in. What is it?', zh: '门廊灯一直在嗡。进来。什么事？' },
  }, {
    id: 'jesse', name: 'Jesse', nameZh: '杰西', color: '#93d7ff',
    oneLiner: { en: 'A cook with a conscience. Street-smart, impulsive, and desperately loyal.', zh: '有良知的制作者。街头聪明、冲动，却又极度忠诚。' },
    relationOptions: ['partner', 'old friend', 'dealer contact', 'person he disappointed'],
    opener: { en: 'Yo, fridge is empty except mustard. You eating, or just hovering?', zh: 'Yo，冰箱里除了芥末啥也没有。你是来吃的，还是来飘着的？' },
  }, {
    id: 'skyler', name: 'Skyler', nameZh: '斯凯勒', color: '#f3d9a2',
    oneLiner: { en: 'The wife who found the cracks. Protective, sharp, and running out of patience.', zh: '发现了裂痕的妻子。护家心切、敏锐，耐心快要耗尽。' },
    relationOptions: ['spouse', 'family member', 'neighbor', 'person hiding something'],
    opener: { en: 'Dish rack is still wet. Ask once. Answer once. What happened?', zh: '碗架还是湿的。问一次，答一次。出什么事了？' },
  }, {
    id: 'saul', name: 'Saul', nameZh: '索尔', color: '#f7ce46',
    oneLiner: { en: 'A criminal lawyer who sees every problem as a business opportunity.', zh: '把每个问题都看成商机的刑事律师。' },
    relationOptions: ['client', 'business partner', 'witness', 'problem to solve'],
    opener: { en: 'Good news: you came to the right office. Bad news: that usually means something went very wrong.', zh: '好消息是：你找对办公室了。坏消息是：这通常说明事情已经非常不对劲。' },
  }, {
    id: 'mike', name: 'Mike', nameZh: '迈克', color: '#b9c0a5',
    oneLiner: { en: 'A former cop who cleaned up after everyone. Quiet, lethal, and exhausted by incompetence.', zh: '为所有人善后的前警探。安静、致命，厌倦了愚蠢。' },
    relationOptions: ['asset', 'employer', 'person under protection', 'loose end'],
    opener: { en: 'Sit down. Talk less. Start with the part you think I do not already know.', zh: '坐下。少说废话。从你以为我还不知道的部分开始。' },
  }, {
    id: 'gus', name: 'Gus', nameZh: '古斯', color: '#b2f09a',
    oneLiner: { en: 'A restaurant owner with absolute control. Every gesture is calculated, every silence is a threat.', zh: '拥有绝对控制权的餐厅老板。每个动作都经过计算，每段沉默都是威胁。' },
    relationOptions: ['employee', 'supplier', 'guest', 'person being evaluated'],
    opener: { en: 'Please, sit. The fryer just went quiet. What do you need?', zh: '请坐。炸炉刚停了声。你需要什么？' },
  }, {
    id: 'hank', name: 'Hank', nameZh: '汉克', color: '#f0a36b',
    oneLiner: {
      en: 'A loud DEA agent with a soft spot for family. Jokes first, then the questions that stick.',
      zh: '吵闹的 DEA 探员，对家人护短。先开玩笑，再问到你改口。',
    },
    relationOptions: [
      'family member',
      'DEA partner',
      'suspect under watch',
      'friend of the family',
    ],
    opener: {
      en: 'Grill smoke is still on my shirt. Sit. Where does the story get weird?',
      zh: '衬衫上还沾着烤肉烟味。坐。故事从哪开始不对劲？',
    },
  }, {
    id: 'marie', name: 'Marie', nameZh: '玛丽', color: '#c8b6e2',
    oneLiner: {
      en: 'Hank\u2019s wife and Skyler\u2019s younger sister. Polished hospitality with a sharp eye for what does not add up at home.',
      zh: '汉克的妻子，斯凯勒的妹妹。礼貌周到，对家里说不通的地方尤其敏锐。',
    },
    relationOptions: [
      'Skyler sister-in-law',
      'Hank spouse',
      'supportive but uncomprehending',
      'neighbor',
    ],
    opener: {
      en: 'Come sit down. I made the kitchen look nice and I want to hear how your day is going.',
      zh: '坐下吧。我把厨房收拾了一下，想听听你今天过得怎么样。',
    },
  },
]

const relationLabels: Record<string, Record<Language, string>> = {
  'former student': { en: 'student', zh: '学生' },
  'family member': { en: 'family', zh: '家人' },
  'lab partner': { en: 'lab partner', zh: '实验室搭档' },
  'DEA liability': { en: 'liability (Hank might look into you)', zh: '隐患（汉克可能会查到你）' },
  'old colleague': { en: 'old colleague', zh: '老同事' },
  partner: { en: 'partner', zh: '搭档' },
  'old friend': { en: 'old friend', zh: '老朋友' },
  'dealer contact': { en: 'contact on the street', zh: '道上的熟人' },
  'younger sibling figure': { en: 'little-brother figure', zh: '像弟弟妹妹一样的人' },
  'person he disappointed': { en: 'someone he let down', zh: '被他辜负过的人' },
  spouse: { en: 'husband', zh: '丈夫' },
  'bookkeeping client': { en: 'bookkeeping client', zh: '记账的客户' },
  neighbor: { en: 'neighbor', zh: '邻居' },
  'person hiding something': { en: 'someone hiding something from her', zh: '有事瞒着她的人' },
  client: { en: 'client', zh: '客户' },
  witness: { en: 'witness', zh: '证人' },
  'business partner': { en: 'business partner', zh: '生意伙伴' },
  'problem to solve': { en: 'problem he has to fix', zh: '要他摆平的麻烦' },
  'person with cash': { en: 'someone bringing cash', zh: '来送钱的人' },
  asset: { en: 'informant', zh: '线人' },
  employer: { en: 'employer', zh: '雇主' },
  'person under protection': { en: 'someone he protects', zh: '他罩着的人' },
  'loose end': { en: 'loose end', zh: '知道太多的人' },
  rookie: { en: 'rookie', zh: '新手' },
  employee: { en: 'employee', zh: '员工' },
  supplier: { en: 'supplier', zh: '供货的人' },
  rival: { en: 'rival', zh: '对手' },
  guest: { en: 'guest', zh: '客人' },
  'person being evaluated': { en: 'someone he is sizing up', zh: '他正在考察的人' },
  'DEA partner': { en: 'partner at the DEA', zh: '局里的搭档' },
  'suspect under watch': { en: 'suspect he is watching', zh: '他盯上的嫌疑人' },
  'friend of the family': { en: 'friend of the family', zh: '家里的朋友' },
  'Skyler sister-in-law': { en: "in-law (Skyler's side)", zh: '亲戚（斯凯勒家这边）' },
  'Hank spouse': { en: 'husband (Hank)', zh: '丈夫（汉克）' },
  'supportive but uncomprehending': { en: "someone supportive who doesn't quite get her", zh: '支持她、但不太懂她的人' },
}

const uiText: Record<Language, Record<string, string>> = {
  en: {
    character: 'Characters',
    language: 'Language',
    relation: 'You are',
    view: 'Mode',
    story: 'Story',
    direct: '1:1',
    crew: 'Group chat',
    model: 'AI settings',
    storyTitle: 'Breaking Bad Roleplay',
    setStage: 'Where do you want to start?',
    setStageHint: 'Describe the conflict you want in a sentence or two. The story plays out part by part and stops when it needs your decision.',
    placeholder: 'e.g. Walter needs a new supply from Gus without Skyler finding out…',
    startStory: 'Start story',
    you: 'You',
    send: 'Send',
    waitingAs: '{character} is thinking…',
    inspectThinking: 'How they played it',
    messagePlaceholder: 'Say something to {character}…',
    privateScene: '1:1',
    crewScene: 'Group chat',
    gifTrigger: 'Scene clip',
    connecting: 'Starting…',
    storyComplete: 'This chapter is over.',
    continue: 'Continue',
    stop: 'Stop',
    openingEmotion: 'opening pressure',
    langEn: 'EN',
    beatRedirect: '↩ Change direction',
    beatSwitchPerspective: '👤 Play someone else',
    beatSubmit: 'Submit',
    beatCancel: 'Cancel',
    beatSelectCharacter: 'Select character…',
    beatRedirectPlaceholder: 'Where should the story go?',
    savePrompt: 'Sign in to save this chat to the cloud.',
    langZh: '中文',
    resumingStory: 'Resuming previous story...',
    reconnect: 'Reconnect',
    restart: 'Restart',
    autoContinue: 'No move for 5 minutes — the story continues on its own…',
    streaming: 'Playing',
    returnToLanding: '↩ Home',
    continueChapter: 'Start Chapter 2',
    branchStory: 'Try another path',
    replayBeat: 'Replay last part',
    startAgain: 'Start Again',
    plotNet: 'Story so far',
    plotNetShow: 'Open story so far',
    plotNetHide: 'Close',
    plotNetLoad: 'Loading…',
    plotNetError: 'Could not load.',
    plotNetEmpty: 'Play a few parts first — this fills in as things happen.',
    plotNetPast: 'Already happened',
    plotNetNow: 'Now',
    plotNetFog: 'Not known yet',
    plotNetKnown: 'You already know',
    plotNetShifting: 'Still shifting',
    plotNetCast: 'Who spoke',
    plotNetNoPast: 'The story starts here.',
    plotNetNoFog: 'Nothing unresolved yet.',
    plotNetHint: 'Only what happened in this story.',
    plotNetBeats: 'parts',
    plotNetCastMeta: 'cast',
    plotNetLines: 'lines',
    plotNetNowTag: 'NOW',
    plotNetFogTag: 'UNKNOWN',
    location: 'Location',
    storyLocationFallback: 'North of ABQ',
    archiveHandle: 'Menu',
    stopGenerating: 'Stop',
    newMessages: 'New messages',
    storyStartHint: 'Tip: press ⌘/Ctrl+Enter to start',
    interLabel: 'YOUR TURN',
    interSub: 'You decide what happens next',
  },
  zh: {
    character: '角色',
    language: '语言',
    relation: '你的身份',
    view: '玩法',
    story: '剧情',
    direct: '单聊',
    crew: '群聊',
    model: 'AI 设置',
    storyTitle: '绝命毒师 · 角色扮演',
    setStage: '你想从哪儿开始？',
    setStageHint: '用一两句话写下你想演的冲突。剧情会一段一段往下演，到要你做决定时停下来。',
    placeholder: '例如：沃尔特得从古斯那里弄到新的原料，还不能让斯凯勒发现…',
    startStory: '开始剧情',
    you: '你',
    send: '发送',
    waitingAs: '{character}还在想…',
    inspectThinking: '他怎么想的',
    messagePlaceholder: '对{character}说…',
    privateScene: '单聊',
    crewScene: '群聊',
    gifTrigger: '剧中画面',
    connecting: '正在开始…',
    storyComplete: '这一章结束了。',
    continue: '继续',
    stop: '停止',
    reconnect: '重新连接',
    restart: '重新开始',
    autoContinue: '5 分钟没有操作，剧情自动往下演…',
    streaming: '正在演',
    resumingStory: '正在恢复上次剧情…',
    openingEmotion: '开场压迫',
    langZh: '中文',
    langEn: 'EN',
    beatRedirect: '↩ 换个方向',
    beatSwitchPerspective: '👤 换个人演',
    beatSubmit: '提交',
    beatCancel: '取消',
    beatSelectCharacter: '选择角色…',
    beatRedirectPlaceholder: '你想让剧情往哪儿走？',
    savePrompt: '登录后，这段聊天会保存到云端。',
    returnToLanding: '↩ 回到首页',
    continueChapter: '开始第二章',
    branchStory: '换条路重来',
    replayBeat: '重演最后一段',
    startAgain: '重新开始',
    plotNet: '剧情回顾',
    plotNetShow: '打开剧情回顾',
    plotNetHide: '关闭',
    plotNetLoad: '正在加载…',
    plotNetError: '加载失败。',
    plotNetEmpty: '多玩几段，这里会记下发生过的事。',
    plotNetPast: '已经发生',
    plotNetNow: '现在',
    plotNetFog: '还不知道',
    plotNetKnown: '你已知道',
    plotNetShifting: '正在变化',
    plotNetCast: '谁说过话',
    plotNetNoPast: '故事从这里开始。',
    plotNetNoFog: '暂时没有悬着的事。',
    plotNetHint: '只记这一局里发生的事。',
    plotNetBeats: '段',
    plotNetCastMeta: '角色',
    plotNetLines: '台词',
    plotNetNowTag: '现在',
    plotNetFogTag: '未知',
    location: '地点',
    storyLocationFallback: '阿尔伯克基北部',
    archiveHandle: '菜单',
    stopGenerating: '停止',
    newMessages: '新消息',
    storyStartHint: '提示：按 ⌘/Ctrl+Enter 快速开始',
    interLabel: '轮到你了',
    interSub: '你来决定下一步',
  },
}


/* ------------------------------------------------------------------ */
function getRelationLabel(relation: string, lang: Language): string {
  return relationLabels[relation]?.[lang] ?? relation
}

function charName(char: Character, lang: Language): string {
  return lang === 'zh' ? char.nameZh : char.name
}

/** One way to say how many messages are left (docs/GLOSSARY.md「免费次数」). */
function formatUsage(quota: { byok: boolean; remaining: number }, lang: Language): string {
  if (quota.byok) return lang === 'zh' ? '用你自己的 API Key · 不限次数' : 'Your own API key · unlimited'
  return lang === 'zh' ? `今天还剩 ${quota.remaining} 次` : `${quota.remaining} left today`
}

/** 「你是沃尔特的：」 — the chat header shows this before the relation picker. */
function relationPrefix(char: Character, lang: Language): string {
  return lang === 'zh' ? `你是${charName(char, lang)}的：` : `You are ${char.name}'s:`
}

/*  BeatControls - decision UI at beat_ready                          */
/* ------------------------------------------------------------------ */

type BeatAction = 'continue' | 'stop' | 'redirect' | 'switch_perspective'

interface BeatControlsProps {
  t: Record<string, string>
  characters: Character[]
  onContinue: () => void | Promise<unknown>
  onStop: () => void | Promise<unknown>
  onRedirect: (prompt: string) => void | Promise<unknown>
  onSwitchPerspective: (charId: string) => void | Promise<unknown>
}

function BeatControls({ t, characters, onContinue, onStop, onRedirect, onSwitchPerspective }: BeatControlsProps) {
  const [pending, setPending] = useState<BeatAction | null>(null)
  const [redirectOpen, setRedirectOpen] = useState(false)
  const [redirectText, setRedirectText] = useState('')
  const [perspectiveOpen, setPerspectiveOpen] = useState(false)

  const wrap = (action: BeatAction, fn: () => void | Promise<unknown>) => async () => {
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

const PRODUCT_SURFACE = 'v3-mode-door' as const
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

/**
 * T10 follow-up: close the last way back into Story for visitors.
 *
 * The gate only refuses *clicks*, so a visitor who played before Story closed
 * still has the board stored (`abq_enteredWorld=true` + Story surface) and a
 * reload used to resume it. Reset that before `usePersistedState` hydrates
 * `enteredWorld`, so the first frame is already the cold-open door — no story
 * frame that flashes and then jumps away. Authors (`?authoring=1` / stored
 * switch) keep their board. Decision + storage shape live in
 * `reclaimVisitorStorySurface` (`src/lib/storyAvailability.ts`).
 */
function reclaimVisitorStorySurfaceBeforePaint(storyOpen: boolean): void {
  reclaimVisitorStorySurface({
    storyOpen,
    store: {
      readSurface: () => readLs<string | null>('surface', null),
      readEnteredWorld: () => readLs<boolean>('enteredWorld', false),
      writeEnteredWorld: (value) => writeLs('enteredWorld', value),
    },
  })
}

/* ------------------------------------------------------------------ */
/*  App                                                               */
/* ------------------------------------------------------------------ */

function App() {
  // Pre-paint migration: first frame must already be cold open for pre-v2 LS.
  migrateProductSurfaceBeforePaint()
  // P2: merge legacy view+mode into surface before React hydrates it.
  migrateSurfaceBeforePaint()
  const playSurface = applyPlaySurfaceToStorage(window.location.search, writeLs)
  if (playSurface) {
    const url = new URL(window.location.href)
    url.searchParams.delete('surface')
    window.history.replaceState(null, '', url)
  }

  // Language: Chinese product first. Browser English still wins if the
  // visitor's UI is en*; a prior visit persists whichever they last chose.
  const defaultLanguage: Language = navigator.language.toLowerCase().startsWith('en') ? 'en' : 'zh'
  const [storedLanguage, setLanguage] = usePersistedState<Language | null>('language', null)
  const language: Language = storedLanguage ?? defaultLanguage
  const t = uiText[language]

  /* T10 (product decision 2026-09-18): Story stays closed to visitors — the
   * STORY card and the 剧情 button show "剧情正在开发中" instead of entering the
   * board. Authors keep it for local development: `?authoring=1` (persisted in
   * localStorage `yishu_authoring_mode`) or `?authoring=0` to close it again.
   * Resolved once per load, at runtime, so dev and the deployed build behave
   * the same. Gate + copy live in `src/lib/storyAvailability.ts`. */
  const [authoringMode] = useState(() => resolveAuthoringMode())
  const storyOpen = canEnterStory(authoringMode)
  /** Visitor pressed a blocked 剧情 entry in the settings drawer. */
  const [storyClosedNotice, setStoryClosedNotice] = useState(false)

  /* T10 follow-up: a pre-closure visitor may still have the Story board stored.
   * Reclaim it before `usePersistedState` hydrates `enteredWorld` below, so the
   * first paint is the cold-open door instead of the story frame. */
  reclaimVisitorStorySurfaceBeforePaint(storyOpen)

  const [surface, setSurface] = usePersistedState<Surface>('surface', 'story', 0)
  const view: View = surface === 'story' ? 'story' : 'chat'
  const mode: ChatMode = surface === 'crew' ? 'crew' : 'direct'
  // A chat partner is not the player-controlled Story actor.
  const [chatCharacterId, setChatCharacterId] = usePersistedState<CharacterId>('character', 'walter', 0)
  const [storyCharacterId, setStoryCharacterId] = usePersistedState<CharacterId>('storyCharacter', 'walter', 0)
  const selectedCharId = view === 'story' ? storyCharacterId : chatCharacterId
  const setSelectedCharId = view === 'story' ? setStoryCharacterId : setChatCharacterId
  const selectedChar = characters.find(c => c.id === selectedCharId) ?? characters[0]
  const threadKey = chatThreadKey(mode, selectedCharId)

  // Pre-v2 LS was reset by migrateProductSurfaceBeforePaint; a visitor's stored
  // Story board by reclaimVisitorStorySurfaceBeforePaint (both run above).
  const [hasEnteredWorld, setHasEnteredWorld] = usePersistedState<boolean>('enteredWorld', false)
  /* Playbook F1/C1: knowledge track doubles as the onboarding-done flag (one tap);
     drama coach mark is one-shot. */
  const [knowledgeTrack, setKnowledgeTrack] = usePersistedState<KnowledgeTrack | null>(
    'knowledgeTrack',
    null,
  )
  const [dramaHintSeen, setDramaHintSeen] = usePersistedState<boolean>('dramaHintSeen', false)
  const [introSeen, setIntroSeen] = usePersistedState<boolean>('introSaulPitch', false)

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
  const relation = (() => {
    const raw = relationByChar[threadKey] ?? selectedChar.relationOptions[0]
    return selectedChar.relationOptions.includes(raw) ? raw : selectedChar.relationOptions[0]
  })()

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
  const [homePreviewOpen, setHomePreviewOpen] = useState(() => new URLSearchParams(window.location.search).get('home') === 'preview')
  const auth = useAuth()
  const quota = useQuota(connection.connectionSessionId, auth.user?.id ?? null)
  const refreshQuota = quota.refresh
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
  const [messagesByChar, setMessagesByChar] = usePersistedState<Record<string, ChatMessage[]>>('messages', {}, 0)
  const messages = useMemo(() => messagesByChar[threadKey] ?? [], [messagesByChar, threadKey])
  const [legacyCloudByChar, setLegacyCloudByChar] = useState<Record<string, ChatMessage[]>>({})
  const legacyMessages = useMemo(() => mergeLegacyChat(
    messagesByChar[selectedCharId] ?? [], legacyCloudByChar[selectedCharId] ?? [],
  ), [messagesByChar, legacyCloudByChar, selectedCharId])
  const [openerRecentByChar, setOpenerRecentByChar] = usePersistedState<Record<string, string[]>>('openerRecent', {})
  const [openerActiveByChar, setOpenerActiveByChar] = usePersistedState<Record<string, string>>('openerActive', {})
  const relationLocked = useMemo(
    () => messages.some((m) => m.sender === 'user'),
    [messages],
  )

  const resolveDirectOpener = useCallback((charId: string, lang: Language, rel: string, mem: CharacterMemory) => {
    const attitude = deriveAttitudeTint(rel, mem.keyFacts ?? [])
    const openThread = firstOpenThread((mem.keyFacts ?? []) as DurableFact[])
    const recent = openerRecentByChar[charId] ?? []
    const picked = pickDirectOpener({
      characterId: charId,
      language: lang,
      attitude,
      relation: rel,
      recentIds: recent,
      openThread,
    })
    if (!picked) {
      const fallback = characters.find((c) => c.id === charId)?.opener
      return {
        id: 'legacy',
        text: fallback?.[lang] ?? fallback?.en ?? '',
      }
    }
    return picked
  }, [openerRecentByChar])

  const rememberOpenerPick = useCallback((charId: string, openerId: string) => {
    setOpenerActiveByChar((prev) => ({ ...prev, [charId]: openerId }))
    if (openerId.startsWith('thread-')) return
    setOpenerRecentByChar((prev) => {
      const prior = prev[charId] ?? []
      const next = [...prior.filter((id) => id !== openerId), openerId].slice(-8)
      return { ...prev, [charId]: next }
    })
  }, [setOpenerActiveByChar, setOpenerRecentByChar])

  // First-visit opener is persisted. If the player has not spoken yet, keep it
  // aligned with the UI language (player-lab 2026-09-09 / eval 2026-09-14).
  useEffect(() => {
    if (view !== 'chat' || mode !== 'direct') return
    setMessagesByChar((prev) => {
      const current = prev[threadKey]
      const activeId = openerActiveByChar[selectedCharId]
      const fromLibrary = activeId
        ? OPENERS_BY_CHARACTER[selectedCharId]?.find((o) => o.id === activeId)
        : null
      if (fromLibrary) {
        const nextText = language === 'zh' ? fromLibrary.zh : fromLibrary.en
        const next = rewriteOpenerText(current, nextText, t.openingEmotion)
        if (next === current) return prev
        return { ...prev, [threadKey]: next ?? [] }
      }
      const next = syncOpenerLanguage(
        current,
        selectedCharId,
        selectedChar.opener,
        language,
        t.openingEmotion,
      )
      if (next === current) return prev
      return { ...prev, [threadKey]: next ?? [] }
    })
  }, [
    language,
    selectedCharId,
    selectedChar.opener,
    t.openingEmotion,
    openerActiveByChar,
    setMessagesByChar,
    threadKey,
    view,
    mode,
  ])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const message = drafts[threadKey] ?? ''
  const setMessage = useCallback((text: string) => {
    setDrafts(prev => ({ ...prev, [threadKey]: text }))
  }, [threadKey])
  const [sendingByThread, setSendingByThread] = useState<Record<string, boolean>>({})
  const isSending = sendingByThread[threadKey] ?? false
  const setIsSending = useCallback((sending: boolean) => {
    setSendingByThread(prev => ({ ...prev, [threadKey]: sending }))
  }, [threadKey])
  const errorScope = view === 'story' ? 'story' : threadKey
  const [errorsByScope, setErrorsByScope] = useState<Record<string, string | null>>({})
  const error = errorsByScope[errorScope] ?? null
  const setError = useCallback((message: string | null) => {
    setErrorsByScope(prev => ({ ...prev, [errorScope]: message }))
  }, [errorScope])
  /** Composer textarea: auto-grow + focus target after send / view switch. */
  const composerRef = useRef<HTMLTextAreaElement>(null)
  /** In-flight /api/chat request; aborted by the stop button. */
  const chatAbortRef = useRef<AbortController | null>(null)
  const chatRequestScopeRef = useRef<string | null>(null)
  useEffect(() => () => {
    if (chatRequestScopeRef.current === `${view}:${threadKey}`) chatAbortRef.current?.abort()
  }, [threadKey, view])
  /** Chat stream: only auto-scroll when the reader is already near the bottom. */
  const [chatPinnedToBottom, setChatPinnedToBottom] = useState(true)
  const [unseenBelow, setUnseenBelow] = useState(false)
  /** Free-text line for DramaDecisionBar (beat pause). */
  const [decisionFree, setDecisionFree] = useState('')
  /** Cold-open choice id so first-beat chips match the crisis the player picked. */
  const [coldOpenChoiceId, setColdOpenChoiceId] = useState<string | null>(null)
  /** Seed kept until 开演 actually starts SSE. */
  const [pendingStoryPrompt, setPendingStoryPrompt] = useState('')
  /** Talkie curtain: false until the player starts this scene. */
  const [curtainRaised, setCurtainRaised] = useState(false)
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
  const story = useStoryStream({
    autoResume: hasEnteredWorld && surface === 'story',
    // Resume toasts / failure copy follow the live UI language.
    language,
  })

  useEffect(() => {
    const actor = story.playerActorId
    if (actor && characters.some(character => character.id === actor)) {
      setStoryCharacterId(actor as CharacterId)
    }
  }, [story.playerActorId, setStoryCharacterId])
  const [storyTask, setStoryTask] = useState('')
  /** Story setup textarea: autofocus target when the board is idle. */
  const storyTaskRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (story.connectionState === 'idle' && !story.sessionId) {
      queueMicrotask(() => setCurtainRaised(false))
    }
  }, [story.connectionState, story.sessionId])

  // Keep story SSE bind token in sync with connection vault.
  useEffect(() => {
    story.setConnectionSessionId(connection.connectionSessionId)
  }, [connection.connectionSessionId, story])

  // P3: teach the story stream to self-heal a 410 binding_expired by
  // re-binding once from the local vault (force: the old id is dead).
  useEffect(() => {
    story.setBindingRecover(async () => {
      const sid = await connection.ensureBound({ force: true })
      return sid || null
    })
  }, [connection, story])

  // Refresh free credits after each story beat pause/complete.
  useEffect(() => {
    if (
      story.connectionState === 'beat_paused'
      || story.connectionState === 'complete'
      || story.connectionState === 'error'
    ) {
      void refreshQuota()
    }
  }, [story.connectionState, refreshQuota])

  // Character memory (per character, sliding window)
  const charMemory = useCharacterMemory()
  const [memoryByChar, setMemoryByChar] = usePersistedState<Record<string, CharacterMemory>>('memory', {}, 0)
  const currentMemory = useMemo(
    () => mode === 'direct' ? memoryByChar[threadKey] ?? { summary: '', keyFacts: [] } : { summary: '', keyFacts: [] },
    [memoryByChar, threadKey, mode],
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
    if (view !== 'chat') return
    let cancelled = false
    // Player-lab (2026-09-09): the visible opener must match the UI language.
    // Library pick prefers attitude + rotation; legacy voiceExamples stay prompt anchors.
    const mem = mode === 'direct' ? memoryByChar[threadKey] ?? { summary: '', keyFacts: [] } : { summary: '', keyFacts: [] }
    const picked = resolveDirectOpener(selectedCharId, language, relation, mem)
    const opener = picked.text

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
            const [msgs, memCloud, legacy] = await Promise.all([
              loadChatMessages(auth.user.id, threadKey, { privacyKey: cloudPrivacy.key }),
              mode === 'direct' ? loadCharacterMemory(auth.user.id, threadKey, { privacyKey: cloudPrivacy.key }) : Promise.resolve(null),
              loadChatMessages(auth.user.id, selectedCharId, { privacyKey: cloudPrivacy.key }),
            ])
            if (cancelled) return
            setLegacyCloudByChar(prev => ({ ...prev, [selectedCharId]: legacy as ChatMessage[] }))
            cloudMsgs = msgs as ChatMessage[]
            cloudMem = memCloud as unknown as CharacterMemory
          } catch {
            setSyncStatus('sync-failed')
          }
        }
      } else {
        setSyncStatus(null)
      }

      if (cancelled) return
      setMessagesByChar(prev => {
        if (cancelled) return prev
        const local = prev[threadKey] ?? []
        const cloudKeys = new Set(cloudMsgs.map(m => JSON.stringify({ sender: m.sender, text: m.text })))
        const localOnly = local.filter(m => !cloudKeys.has(JSON.stringify({ sender: m.sender, text: m.text })))
        const merged = [...localOnly, ...cloudMsgs]

        if (auth.user && cloudPrivacy.key && localOnly.length > 0) {
          const messagesToBackfill = localOnly.filter(m => {
            const key = `${auth.user!.id}:${threadKey}:${m.sender}:${m.text}`
            if (backfilledCloudKeysRef.current.has(key)) return false
            backfilledCloudKeysRef.current.add(key)
            return true
          })
          if (messagesToBackfill.length > 0) {
            persistPrivateChatMessages(auth.user.id, messagesToBackfill.map(m => ({
              character_id: threadKey,
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
          if (mode === 'crew') return prev
          rememberOpenerPick(selectedCharId, picked.id)
          return {
            ...prev,
            [threadKey]: [{
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
        return { ...prev, [threadKey]: merged }
      })

      if (cloudMem) {
        setMemoryByChar(prev => ({ ...prev, [threadKey]: cloudMem }))
      }
    })()
    return () => { cancelled = true }
  }, [auth.user, selectedCharId, threadKey, mode, view, language, relation, cloudPrivacy.status, cloudPrivacy.key]) // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [setMessage])

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
    if (!playing || view !== 'story') return
    // Defer so we do not cascade-render inside the effect body (react-hooks/set-state-in-effect).
    queueMicrotask(() => setSidebarCollapsed(true))
  }, [story.connectionState, view])

  const beginStoryStream = useCallback(async (prompt: string, scenarioId: 'conversation' | 'desert_crisis' = 'conversation') => {
    const seed = prompt.trim()
    if (!seed) return
    if (story.connectionState === 'connecting' || story.connectionState === 'streaming') return
    setError(null)
    setCurtainRaised(true)
    try {
      if (!connection.view.canStart) {
        connection.setSheetOpen(true)
        setError(language === 'zh' ? '先在「AI 设置」里选一个模型。' : 'Pick a model in AI settings first.')
        setCurtainRaised(false)
        return
      }
      const bindId = await connection.ensureBound()
      if (connection.view.mode === 'byok' && !bindId) {
        connection.setSheetOpen(true)
        setError(
          language === 'zh'
            ? '你的 API Key 没有生效，请在「AI 设置」里重新保存。'
            : 'Your API key is not active. Save it again in AI settings.',
        )
        setCurtainRaised(false)
        return
      }
      story.setConnectionSessionId(bindId)
      const started = await story.startStory(
        seed,
        selectedCharId,
        null,
        language,
        bindId,
        scenarioId,
      )
      // A failed start keeps the opening so the retry entry can run it again.
      if (started) setStoryTask('')
    } catch (e) {
      setCurtainRaised(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [story, selectedCharId, language, connection, setError])

  const handleStartStory = useCallback(async () => {
    await beginStoryStream(storyTask)
  }, [beginStoryStream, storyTask])

  const handleRaiseCurtain = useCallback(async () => {
    await beginStoryStream(pendingStoryPrompt || storyTask, pendingStoryPrompt ? 'desert_crisis' : 'conversation')
  }, [beginStoryStream, pendingStoryPrompt, storyTask])

  /* Retry entry for a story-level failure (nothing started / a beat refused).
   * A failed start runs the SAME opening again — the cold-open prompt, or the
   * text the player typed — so retry never asks for the setup twice. */
  const handleRetryStoryStart = useCallback(() => {
    const failure = story.sessionFailure
    if (failure?.kind === 'beat_rejected' && story.sessionId) {
      story.reconnect()
      return
    }
    if (failure?.kind === 'resume_failed') {
      // Re-open the saved story; never start a different one from here.
      void story.retryResume()
      return
    }
    if ((pendingStoryPrompt || storyTask).trim()) {
      void handleRaiseCurtain()
      return
    }
    story.reset()
  }, [story, pendingStoryPrompt, storyTask, handleRaiseCurtain])

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
    // T10 defense in depth: the closed STORY card never calls onStart, and if a
    // future caller does, Story still must not open for visitors.
    if (!storyOpen) return
    if (coldOpenStartingRef.current) return
    if (story.connectionState === 'connecting' || story.connectionState === 'streaming') return
    coldOpenStartingRef.current = true
    setColdOpenStarting(true)

    const charId = payload.characterId as CharacterId
    setStoryCharacterId(charId)
    setColdOpenChoiceId(payload.choiceId)
    setPendingStoryPrompt(payload.storyPrompt)
    setStoryTask(payload.storyPrompt)
    setCurtainRaised(false)
    setColdOpenError(null)
    setError(null)
    try {
      // 场面 first: enter Story on the scene billboard. SSE waits for 开演.
      setHasEnteredWorld(true)
      setSurface('story')
      setSidebarCollapsed(true)
      setColdOpenError(null)
    } finally {
      coldOpenStartingRef.current = false
      setColdOpenStarting(false)
    }
  }, [setHasEnteredWorld, setStoryCharacterId, setSurface, story.connectionState, setError, storyOpen])

  /* T10: the settings drawer's view switch is a second way into Story. Route it
   * through the same gate as the cold-open card and the play-mode bar. */
  const requestSurface = useCallback((next: PlayMode) => {
    if (playModeBlocked(next, storyOpen)) {
      setStoryClosedNotice(true)
      return
    }
    setStoryClosedNotice(false)
    setSurface(next)
  }, [storyOpen, setSurface, setStoryClosedNotice])

  /* ---- Chat send ---- */
  const updateMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessagesByChar(prev => ({
      ...prev,
      [threadKey]: updater(prev[threadKey] ?? []),
    }))
  }, [threadKey, setMessagesByChar])

  const handleSend = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    const userText = message.trim()
    if (!userText || isSending || view !== 'chat') return

    // Bind / open sheet before optimistic UI so a dead BYOK session does not leave a stranded bubble.
    if (!connection.view.canStart) {
      connection.setSheetOpen(true)
      setError(language === 'zh' ? '先在「AI 设置」里选一个模型。' : 'Pick a model in AI settings first.')
      return
    }
    setIsSending(true)
    setError(null)
    const controller = new AbortController()
    chatAbortRef.current = controller
    chatRequestScopeRef.current = `${view}:${threadKey}`
    let bindId: string | null
    try {
      bindId = await connection.ensureBound()
      controller.signal.throwIfAborted()
      if (connection.view.mode === 'byok' && !bindId) {
        connection.setSheetOpen(true)
        throw new Error(
          language === 'zh'
            ? '你的 API Key 没有生效，请在「AI 设置」里重新保存。'
            : 'Your API key is not active. Save it again in AI settings.',
        )
      }
    } catch (e) {
      setIsSending(false)
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      if (chatAbortRef.current === controller) chatAbortRef.current = null
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

    const packedMemory = toDirectChatMemoryWire(
      mode,
      nextHistory.map(m => ({ sender: m.sender, text: m.text })),
    )
    const durableMemory = formatDurableMemoryForWire(
      (updatedAfterUser.keyFacts ?? []) as DurableFact[],
    )

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
          history: packedMemory.history,
          memoryOpening: packedMemory.memoryOpening,
          memoryDigest: packedMemory.memoryDigest,
          durableMemory: mode === 'direct' ? durableMemory : '',
          language,
          llmProvider: connection.view.providerId,
          modelId: connection.view.modelId,
          voiceExample: getVoiceExample(selectedCharId, relation) ?? null,
          connectionSessionId: bindId,
        }),
      })
      if (!res.ok) {
        const quotaErr = await parseQuotaError(res.clone())
        if (quotaErr && quotaBlocksPlay({ open: quota.open, byok: quota.byok, remaining: quota.remaining })) {
          connection.setSheetOpen(true)
          void quota.refresh()
          // Always our own copy: the backend message is English-only and predates docs/GLOSSARY.md.
          throw new Error(
            language === 'zh'
              ? '今天的免费次数用完了。登录可以多拿一些，或者在「AI 设置」里填你自己的 API Key 继续。'
              : 'You have used today’s free messages. Sign in for more, or add your own API key in AI settings.',
          )
        }
        if (quotaErr) {
          void quota.refresh()
        }
        const detail = await res.json().catch(() => ({ error: 'Server error' }))
        const msg =
          typeof detail.detail === 'object' && detail.detail?.message
            ? detail.detail.message
            : detail.error || detail.detail || 'Chat failed'
        throw new Error(msg)
      }
      const data = await res.json()
      controller.signal.throwIfAborted()
      void quota.refresh()

      if (mode === 'crew') {
        const debateReplies: ChatMessage[] = bubblesFromCrewPayload(
          selectedCharId,
          data as Record<string, unknown>,
        )
        if (debateReplies.length === 0) {
          // Billed crew turn produced nothing visible — say so instead of
          // leaving the player's question hanging in silence.
          throw new Error(language === 'zh'
            ? '辩论生成失败（本次不显示内容）。请重试。'
            : 'The debate came back empty. Please try again.')
        }
        updateMessages(current => [...current, ...debateReplies])

        if (auth.user && cloudPrivacy.key && debateReplies.length > 0) {
          setSyncStatus('syncing')
          persistPrivateChatMessages(auth.user.id, [
            {
              character_id: threadKey,
              message: userText,
              sender: 'user',
              emotion: null,
            },
            ...debateReplies.map(reply => ({
              character_id: threadKey,
              message: reply.text,
              sender: reply.sender,
              emotion: reply.emotion ?? null,
            })),
          ], cloudPrivacy.key)
            .then(() => setSyncStatus('synced'))
            .catch(() => setSyncStatus('sync-failed'))
        } else if (auth.user) {
          setSyncStatus('privacy-locked')
        }
      } else {
        const reply: ChatMessage = bubbleFromDirectPayload(
          selectedCharId,
          data as Record<string, unknown>,
        )
        updateMessages(current => [...current, reply])

        // Update memory with character reply
        const finalMemory = charMemory.addTurn(selectedCharId, selectedCharId, reply.text, updatedAfterUser)
        setMemoryByChar(prev => ({ ...prev, [threadKey]: finalMemory }))

        // Persist to Supabase if authenticated
        if (auth.user && cloudPrivacy.key) {
          setSyncStatus('syncing')
          persistPrivateChatMessages(auth.user.id, [
            {
              character_id: threadKey,
              message: userText,
              sender: 'user',
              emotion: null,
            },
            {
              character_id: threadKey,
              message: reply.text,
              sender: selectedCharId,
              emotion: reply.emotion ?? null,
            },
          ], cloudPrivacy.key)
            .then(() => setSyncStatus('synced'))
            .catch(() => setSyncStatus('sync-failed'))
          persistPrivateCharacterMemory(auth.user.id, {
            character_id: threadKey,
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
      updateMessages(prev => prev.filter(m => m.id !== userMsg.id))
      setMessage(userText)
      if (!(e instanceof Error && e.name === 'AbortError')) {
        // Roll back the optimistic bubble and restore the draft so retry is one click.
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      const ownsComposer = chatAbortRef.current === controller && !controller.signal.aborted
      if (chatAbortRef.current === controller) chatAbortRef.current = null
      setIsSending(false)
      const el = ownsComposer ? composerRef.current : null
      if (el) {
        el.focus()
        // Re-grow for a restored draft (or collapse after a cleared one).
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 140)}px`
      }
    }
  }, [message, isSending, messages, selectedCharId, threadKey, view, setMessage, setIsSending, setError, relation, mode, language, connection, updateMessages, auth, currentMemory, charMemory, setMemoryByChar, cloudPrivacy.key, quota])

  /* ---- Character change ---- */
  const handleCharChange = useCallback((id: CharacterId) => {
    setSelectedCharId(id)
    setRelationByChar(prev => {
      const key = chatThreadKey(mode, id)
      const savedRelation = prev[key]
      if (savedRelation !== undefined) {
        const found = characters.find(c => c.id === id)
        setRelationNotice(
          found ? `${relationPrefix(found, language)}${getRelationLabel(savedRelation, language)}` : getRelationLabel(savedRelation, language),
        )
      }
      return { ...prev, [key]: savedRelation ?? characters.find(c => c.id === id)!.relationOptions[0] }
    })
    setError(null)
  }, [setSelectedCharId, setRelationByChar, mode, language, setRelationNotice, setError])

  const handleReturnToLanding = useCallback(() => {
    story.reset()
    setStoryTask('')
    setError(null)
    setColdOpenChoiceId(null)
    // QA P0#3: returning to the landing must re-enter through the door,
    // not fall through to the legacy idle setup form. Resetting the
    // knowledge track keeps the brief as the single entry; forcing
    // surface='story' prevents a stale 'direct' surface from rendering
    // the old setup screen after reset.
    setKnowledgeTrack(null)
    setHasEnteredWorld(false)
  }, [story, setHasEnteredWorld, setKnowledgeTrack, setError])

  const storyContextSummary = useMemo(() => {
    const spoken = story.events
      .filter(evt => evt.type === 'agent_speak')
      .slice(-4)
      .map(evt => `${evt.data.character_id ?? 'Character'}: ${evt.data.content ?? ''}`)
      .join('\n')
    return [story.outline, spoken].filter(Boolean).join('\n\n')
  }, [story.events, story.outline])

  const readingBlocks = useMemo(
    () => buildReadingBlocks(story.events, language),
    [story.events, language],
  )
  const onStageLore = useMemo(
    () => extractOnStageLore(story.events, language),
    [story.events, language],
  )
  const sceneBill = useMemo(
    () => buildStorySceneBill({
      choiceId: coldOpenChoiceId,
      characterId: selectedCharId,
      language,
      knowledgeTrack,
    }),
    [coldOpenChoiceId, selectedCharId, language, knowledgeTrack],
  )
  const showSceneBill = holdsSceneCurtain({
    connectionState: story.connectionState,
    curtainRaised,
    hasLiveSession: Boolean(story.sessionId),
  }) && Boolean(coldOpenChoiceId || pendingStoryPrompt)
  const lastSpeak = useMemo(
    () => findLastStoryEvent(story.events, evt => evt.type === 'agent_speak'),
    [story.events],
  )
  const lastSpeakId = lastSpeak
    ? DISPLAY_NAME_TO_ID[lastSpeak.data.character_id as string]
    : null
  const lastSpeakText = typeof lastSpeak?.data.content === 'string' ? lastSpeak.data.content : ''
  const dramaHint = readingBlocks.find(b => b.kind === 'dialogue' || b.kind === 'narration')?.text.slice(0, 80)
    || ''

  const storyConnectionState = story.connectionState
  const storySendAction = story.sendAction
  useEffect(() => {
    if (view !== 'story') return
    if (storyConnectionState !== 'beat_paused') return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (
        tag === 'INPUT'
        || tag === 'TEXTAREA'
        || tag === 'SELECT'
        || target?.isContentEditable
      ) return
      if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A') {
        e.preventDefault()
        void storySendAction('continue', undefined, selectedCharId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, storyConnectionState, storySendAction, selectedCharId])

  const latestWorldDelta = useMemo(
    () => findLastStoryEvent(story.events, evt => evt.type === 'world_state_delta'),
    [story.events],
  )
  const storyLocation = useMemo(() => {
    if (onStageLore.location) return onStageLore.location.slice(0, 40)
    return t.storyLocationFallback
  }, [onStageLore.location, t.storyLocationFallback])
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
    ? `第 ${Math.max(story.beatIndex, 1)} 段`
    : `Part ${Math.max(story.beatIndex, 1)}`
  const stageBeatNo = Math.max(story.beatIndex, 1)

  const handleContinueChapter = useCallback(async () => {
    const base = defaultStoryPrompt(language)
    const instruction = language === 'zh'
      ? `${base}\n\n作为第二章继续。保留第一章后果，提高压力，不要重开故事。`
      : `${base}\n\nContinue this as Chapter 2. Keep the consequences of Chapter 1 intact, raise the pressure, and do not restart the story.`
    const context = language === 'zh'
      ? `第一章上下文：\n${storyContextSummary || '暂无上下文。'}`
      : `Chapter 1 context:\n${storyContextSummary || 'No previous context was captured.'}`
    const branchGoal = boundedStoryDirection(instruction, context)
    await story.sendAction('continue_chapter', { branch_goal: branchGoal }, selectedCharId)
  }, [selectedCharId, story, storyContextSummary, language])

  const handleBranchStory = useCallback(async () => {
    const base = defaultStoryPrompt(language)
    const instruction = language === 'zh'
      ? `${base}\n\n从关键节点分叉。保留设定，但因角色冲突走向完全不同的剧情。`
      : `${base}\n\nBranch from the earlier decisive beat. Preserve the setup, then take the plot in a sharply different direction chosen by character conflict rather than coincidence.`
    const context = language === 'zh'
      ? `原上下文：\n${storyContextSummary || '暂无上下文。'}`
      : `Original context:\n${storyContextSummary || 'No previous context was captured.'}`
    const branchGoal = boundedStoryDirection(instruction, context)
    const fromBeatId = canonicalBeatId(story.currentBeatId, story.beatIndex)
    await story.sendAction(
      'branch',
      { from_beat_id: fromBeatId, branch_goal: branchGoal },
      selectedCharId,
    )
  }, [selectedCharId, story, storyContextSummary, language])

  const handleReplayBeat = useCallback(async () => {
    const beatId = canonicalBeatId(story.currentBeatId, story.beatIndex)
    await story.redrawBeat(beatId, selectedCharId)
  }, [story, selectedCharId])

  /* ---- Cold open (brief question → crisis → cast) ---- */
  if (homePreviewOpen) {
    const leaveHomePreview = () => {
      const url = new URL(window.location.href)
      url.searchParams.delete('home')
      url.hash = ''
      window.history.replaceState(null, '', url)
      setHomePreviewOpen(false)
      window.scrollTo(0, 0)
    }
    return <HomePreview
      onStory={() => {
        setLanguage('zh')
        setKnowledgeTrack('fresh')
        setHasEnteredWorld(false)
        leaveHomePreview()
      }}
      onChat={(character) => {
        setLanguage('zh')
        setChatCharacterId(character)
        setSurface('direct')
        setHasEnteredWorld(true)
        leaveHomePreview()
      }}
      onCrew={() => {
        setLanguage('zh')
        setSurface('crew')
        setHasEnteredWorld(true)
        leaveHomePreview()
      }}
    />
  }
  if (!hasEnteredWorld) {
    return (
      <>
        <ColdOpenLanding
          language={language}
          knowledgeTrack={knowledgeTrack}
          onKnowledgePick={(t) => setKnowledgeTrack(t)}
          onStart={handleColdOpenStart}
          onEnterDirect={() => {
            setSurface('direct')
            setHasEnteredWorld(true)
            setSidebarCollapsed(false)
          }}
          onEnterCrew={() => {
            setSurface('crew')
            setHasEnteredWorld(true)
            setSidebarCollapsed(false)
          }}
          onOpenSettings={() => {
            setColdOpenError(null)
            connection.setSheetOpen(true)
          }}
          storyOpen={storyOpen}
          onLanguageChange={(lang) => setLanguage(lang)}
          starting={coldOpenStarting}
          error={coldOpenError}
          showIntro={!introSeen}
          onIntroDone={() => setIntroSeen(true)}
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
    dramaHint,
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
        className={`app-shell${sidebarCollapsed ? ' app-shell--sidebar-collapsed' : ''}${view === 'story' && sidebarCollapsed ? ' app-shell--story-focus' : ''}${view === 'chat' ? ' app-shell--chat-paper' : ''}`}
        lang={language === 'zh' ? 'zh-CN' : 'en'}
      >
        <div className={`sidebar-wrapper ${sidebarCollapsed ? 'sidebar-wrapper--collapsed' : ''}`}>
          <button
            type="button"
            className="sidebar__toggle"
            onClick={() => setSidebarCollapsed(v => !v)}
            aria-label={sidebarCollapsed ? t.archiveHandle : (language === 'zh' ? '收起菜单' : 'Hide menu')}
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
                <Silhouette characterId={c.id} name={charName(c, language)} size={42} />
                <div className="char-card__info">
                  <strong>{charName(c, language)}{language === 'zh' && <small className="char-card__en">{c.name}</small>}</strong>
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
              <button className={surface === 'story' ? 'active' : ''} onClick={() => requestSurface('story')} aria-pressed={surface === 'story'} aria-disabled={!storyOpen || undefined}>{t.story}</button>
              <button className={surface === 'direct' ? 'active' : ''} onClick={() => requestSurface('direct')} aria-pressed={surface === 'direct'}>{t.direct}</button>
              <button className={surface === 'crew' ? 'active' : ''} onClick={() => requestSurface('crew')} aria-pressed={surface === 'crew'}>{t.crew}</button>
            </div>
            {storyClosedNotice && !storyOpen && <StoryComingSoonNotice language={language} />}
          </section>

          <section className="connection-sidebar-block">
            <span className="field-label">{t.model}</span>
            <ConnectionChip conn={connection} language={language} />
            {(quota.byok || !quota.open) && (
              <p className={`quota-pill${!quota.open && quota.remaining <= 2 && !quota.byok ? ' is-low' : ''}`}>
                {formatUsage(quota, language)}
              </p>
            )}
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
            <div className="story-hud__night">
              <ElementSquare symbol={String(stageBeatNo)} num="" green size={30} />
              <div className="story-hud__night-txt">
                <span className="story-hud__night-en">{storyBeatLabel}</span>
              </div>
            </div>
            <div className="story-hud__metric story-hud__metric--slug">
              <span>{t.location}</span>
              <strong>{storyLocation}</strong>
              <small>{language === 'zh' ? '你扮演：' : 'You play: '}{charName(selectedChar, language)}</small>
              {storyWorldClock && <small className="world-clock">{storyWorldClock}</small>}
            </div>
            {/* QA P2#10: language switch reachable in-game, not only on the
                cold open toolbar. Quiet pill, same seg-control grammar. */}
            <PlayModeBar
              value={surface as PlayMode}
              language={language}
              storyOpen={storyOpen}
              onChange={(mode) => {
                setSurface(mode)
                setSidebarCollapsed(mode === 'story')
              }}
            />
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
            {/* Stage v2 HUD right: credits always on, amber mono (design hud-credits). */}
            {(quota.byok || !quota.open) && (
              <div
                className={`story-hud__credits${!quota.open && !quota.byok && quota.remaining <= 2 ? ' is-low' : ''}`}
              >
                {formatUsage(quota, language)}
              </div>
            )}
          </header>

          {showSceneBill && (
            <StorySceneBillboard
              bill={sceneBill}
              holding={curtainRaised || story.connectionState === 'connecting'}
              onRaiseCurtain={() => { void handleRaiseCurtain() }}
            />
          )}

          {story.connectionState === 'idle' && !showSceneBill && (
            <div className="story-setup">
              <h3>{t.setStage}</h3>
              <p>{t.setStageHint}</p>
              <p className="story-setup__identity">
                {language === 'zh' ? '你扮演：' : 'You play: '}{charName(selectedChar, language)}
              </p>
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

          {story.connectionState === 'connecting' && !showSceneBill && (
            <div className="story-status story-status--pulse" aria-live="polite">
              <p>{story.isResuming
                ? (t.resumingStory)
                : t.connecting}</p>
            </div>
          )}

          {story.connectionState === 'error' && story.sessionFailure && (
            <StoryFailureNotice
              failure={story.sessionFailure}
              language={language}
              onRetry={handleRetryStoryStart}
              onReset={story.reset}
              resetLabel={t.restart}
            />
          )}

          {story.connectionState === 'error' && !story.sessionFailure && (
            <div className="story-error">
              <p>
                ⚠{' '}
                {story.streamFailure?.kind === 'quota' && quotaBlocksPlay({
                  open: quota.open,
                  byok: quota.byok,
                  remaining: quota.remaining,
                })
                  ? (language === 'zh'
                    ? '今天的免费次数用完了。登录可以多拿一些，或者在「AI 设置」里填你自己的 API Key 继续。进度已保存。'
                    : 'You have used today’s free messages. Sign in for more, or add your own API key in AI settings. Your progress is saved.')
                  : story.streamFailure?.kind === 'timeout'
                    ? (language === 'zh'
                      ? '剧情 90 秒没有回应。进度已保存，可以直接重试。'
                      : 'The story went quiet for 90 seconds. Your progress is saved — retry now.')
                    : story.streamFailure?.kind === 'network'
                      ? (language === 'zh'
                        ? '连接断了，自动重连也没成功。进度已保存，可以重试。'
                        : 'The connection dropped and auto-reconnect failed. Your progress is saved — retry.')
                      : story.getCharState(selectedCharId).error}
              </p>
              {story.sessionId && (story.streamFailure?.kind !== 'quota' || !quotaBlocksPlay({
                open: quota.open,
                byok: quota.byok,
                remaining: quota.remaining,
              })) && (
                <button type="button" onClick={story.reconnect}>
                  {language === 'zh' ? '重试' : 'Retry'}
                </button>
              )}
              {story.streamFailure?.kind === 'quota' && quotaBlocksPlay({
                open: quota.open,
                byok: quota.byok,
                remaining: quota.remaining,
              }) && (
                <button type="button" onClick={() => connection.setSheetOpen(true)}>
                  {language === 'zh' ? '填自己的 API Key' : 'Add your own API key'}
                </button>
              )}
              <button type="button" onClick={story.reset}>
                {t.restart}
              </button>
              {error && <ErrorBox message={error} onDismiss={() => setError(null)} />}
            </div>
          )}

          {(story.connectionState === 'streaming'
            || story.connectionState === 'beat_paused'
            || story.connectionState === 'complete') && (
            <div className={`story-stream story-stream--reading story-stream--${story.connectionState}`}>
              <StoryReadingSurface
                blocks={readingBlocks}
                lore={onStageLore}
                language={language}
                canRedraw={story.connectionState === 'beat_paused' || story.connectionState === 'complete'}
                onRedrawBeat={() => { void handleReplayBeat() }}
                slate={(
                  <p className="story-reading__slate">
                    {sceneBill.place}
                    {' · '}
                    {sceneBill.onStage.map((face) => face.name).join(' / ')}
                  </p>
                )}
                voice={lastSpeakId && lastSpeakText ? (
                  <VoicePlayer
                    text={lastSpeakText}
                    characterId={lastSpeakId}
                    language={language}
                    connectionSessionId={connection.connectionSessionId}
                  />
                ) : null}
              />

              {story.connectionState === 'streaming' && (
                <div className="streaming-indicator streaming-indicator--diegetic" aria-live="polite" aria-busy="true">
                  {story.autoContinued ? (
                    <span className="auto-continue-notice">
                      {t.autoContinue}
                    </span>
                  ) : null}
                </div>
              )}

              {story.connectionState === 'beat_paused' && (
                <div className="beat-paused beat-paused--drama">
                  <div className="beat-paused__interhead">
                    <span className="beat-paused__intersq" aria-hidden="true" />
                    <span>{t.interLabel}</span>
                    <small>{t.interSub}</small>
                  </div>
                  {story.commandNotice && (
                    <p className="beat-paused__notice" role="status">
                      {story.commandNotice.message}
                    </p>
                  )}
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
                        'act',
                        { player_input: s.payload, player_kind: s.kind },
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
                      // Keep the typed line when the move was refused (an
                      // earlier command is still unconfirmed) — the player
                      // must not have to remember and retype their words.
                      void story.sendAction(
                        'act',
                        { player_input: text, player_kind: 'free' },
                        selectedCharId,
                      ).then((accepted) => {
                        if (accepted) setDecisionFree('')
                      })
                    }}
                    disabled={
                      story.connectionState !== 'beat_paused'
                    }
                  />
                  <details className="beat-paused__advanced">
                    <summary>
                      {language === 'zh' ? '更多操作' : 'More options'}
                    </summary>
                    <BeatControls
                      t={t}
                      characters={characters.map(c => ({ ...c, name: charName(c, language) }))}
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
                    {language === 'zh'
                      ? '剧情不会一直写下去。可以打开剧情回顾看看发生了什么，或者从上面选一个继续。'
                      : 'The story does not go on forever. Open “Story so far” to look back, or pick one of the options above.'}
                  </p>
                </div>
              )}

              {error && <ErrorBox message={error} onDismiss={() => setError(null)} />}
            </div>
          )}
        </section>
      ) : (
        /* ---------- Chat View ---------- */
        <section className={`chat-panel chat-refresh ${sceneReady ? 'is-crossfade' : ''}`}>
          <div className="scene-layer scene-layer--prev" style={{ backgroundImage: prevSceneUrl ? `url(${prevSceneUrl})` : 'none' } as CSSProperties} />
          <div className="scene-layer scene-layer--current" style={{ backgroundImage: `url(${currentSceneUrl})` } as CSSProperties} />
          <header className="chat-header">
            <div>
              <p>{mode === 'crew' ? t.crewScene : t.privateScene}</p>
                  <h2>
                    {charName(selectedChar, language)}
                  </h2>
                  {showSavePrompt && (
                    <div className="save-prompt">
                      {t.savePrompt}
                </div>
              )}
            </div>
            <PlayModeBar
              value={surface as PlayMode}
              language={language}
              storyOpen={storyOpen}
              onChange={(next) => {
                setSurface(next)
                setSidebarCollapsed(next === 'story')
              }}
            />
            <a className="chat-character-link" href="/?home=preview#characters">{language === 'zh' ? '选择角色' : 'Characters'}</a>
            <label className="chat-header__relation" htmlFor="chat-relation">
              <span className="chat-header__relation-prefix">{relationPrefix(selectedChar, language)}</span>
              {relationLocked ? (
                <span className="chat-header__relation-locked" title={language === 'zh' ? '聊起来以后身份就定了，可以在对话里改口' : 'Set once you start talking — you can correct it in the chat'}>
                  {getRelationLabel(relation, language)}
                </span>
              ) : (
                <select
                  id="chat-relation"
                  value={relation}
                  onChange={e => setRelationByChar(prev => ({ ...prev, [threadKey]: e.target.value }))}
                  aria-label={t.relation}
                >
                  {selectedChar.relationOptions.map(opt => (
                    <option key={opt} value={opt}>{getRelationLabel(opt, language)}</option>
                  ))}
                </select>
              )}
            </label>
          </header>

          {legacyMessages.length > 0 && (
            <details className="chat-legacy-archive" key={selectedCharId}>
              <summary>{language === 'zh' ? '旧版聊天记录（只读）' : 'Legacy conversations (read-only)'}</summary>
              <p>{language === 'zh'
                ? '旧版记录未区分单聊和群聊，保留供回看，不自动带入新对话。'
                : 'These older records did not separate 1:1 and group chats. They are kept for reading and are not sent into new conversations.'}</p>
              {legacyMessages.map((row, index) => <p key={index}><strong>{row.sender}: </strong>{row.text}</p>)}
            </details>
          )}
          <div className="chat-stream" ref={chatStreamRef} onScroll={handleChatScroll}>
            {mode === 'crew' && messages.length === 0 && <p className="chat-empty">
              {language === 'zh' ? '这是一段独立的群聊。你想先和谁聊什么？' : 'A separate group conversation. Who would you like to talk to first?'}
            </p>}
            {messages.map(msg => {
              const isUser = msg.sender === 'user'
              const senderChar = isUser ? null : characters.find(c => c.id === msg.sender)
              const senderName = senderChar ? charName(senderChar, language) : (isUser ? t.you : (msg.sender as string))
              const senderColor = senderChar?.color ?? selectedChar.color
              return (
                <article
                  key={msg.id}
                  className={`msg ${isUser ? 'msg--user' : 'msg--char'} ${messages.length === 1 && msg.id.startsWith('opener-') ? 'msg--opening' : ''}`}
                  style={{ '--char-color': isUser ? 'var(--color-bb-yellow)' : senderColor } as CSSProperties}
                >
                  <div className="msg-avatar" style={{ '--char-color': isUser ? 'var(--color-bb-yellow)' : senderColor } as CSSProperties}>
                    {isUser ? <span className="avatar-letter">{t.you[0]}</span> : <Silhouette characterId={msg.sender as CharacterId} name={senderName} size={36} />}
                  </div>
                  <div className="msg-body">
                    <div className="msg-meta">
                      <strong>{isUser ? t.you : senderName}</strong>
                      {msg.emotion && !msg.id.startsWith('opener-') && <span>{msg.emotion}</span>}
                    </div>
                    <p>{msg.text}</p>
                    {/* tool_executed / tool_log are model-facing key=value strings
                        fed back into the tool loop — not player copy. They stay on
                        the message for the agent harness, but must not be rendered
                        in the player's chat. */}
                    {!isUser && (
                      <VoicePlayer
                        text={msg.text}
                        characterId={msg.sender as CharacterId}
                        language={language}
                        connectionSessionId={connection.connectionSessionId}
                      />
                    )}
                    {isInspectableThinking(msg.thinking) && (
                      <details className="msg-think">
                        <summary>{t.inspectThinking}</summary>
                        <p>{msg.thinking}</p>
                      </details>
                    )}
                    <GifCard src={msg.id.startsWith('opener-') ? null : msg.gifUrl} alt={msg.gifQuery ? t.gifTrigger : ''} />
                  </div>
                </article>
              )
            })}
            <div className="chat-end" aria-hidden="true" />
            {messages.length === 1 && messages[0]?.id.startsWith('opener-') && !isSending && <div className="chat-starters" aria-label={language === 'zh' ? '开场建议' : 'Conversation starters'}>
              {getDirectWayfinders(selectedCharId, language).map(text => <button key={text} type="button" onClick={() => { setMessage(text); composerRef.current?.focus() }}>{text}</button>)}
            </div>}
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
                <span className="typing__label">{t.waitingAs.replace('{character}', charName(selectedChar, language))}</span>
              </div>
            )}
            {error && <ErrorBox message={error} onDismiss={() => setError(null)} />}

            <form className="composer" onSubmit={handleSend}>
              <textarea
                aria-label={language === 'zh' ? '消息' : 'Message'}
                ref={composerRef}
                rows={1}
                value={message}
                onChange={handleComposerChange}
                onKeyDown={handleComposerKeyDown}
                placeholder={t.messagePlaceholder.replace('{character}', charName(selectedChar, language))}
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
