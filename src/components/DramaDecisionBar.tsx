/* =================================================================
   DramaDecisionBar — Story mode bottom decision layer
   Three suggested actions (say / do / observe) + free-text decide.
   ================================================================= */
/* eslint-disable react-refresh/only-export-components -- decision bar also exports suggestion builders */


import type { FormEvent, KeyboardEvent } from 'react'

export type DramaSuggestion = {
  id: string
  kind: 'say' | 'do' | 'observe'
  /** Short button label */
  label: string
  /** Text to send as player action / story choice */
  payload: string
}

export type DramaDecisionBarProps = {
  language: 'zh' | 'en'
  suggestions: DramaSuggestion[]
  disabled?: boolean
  freeValue: string
  onFreeChange: (v: string) => void
  onPick: (s: DramaSuggestion) => void
  /** ONLY called when freeValue trimmed is non-empty */
  onFreeSubmit: () => void
  /** Primary continue path (no free text required) */
  onContinue: () => void
  placeholder?: string
}

const KIND_CLASS: Record<DramaSuggestion['kind'], string> = {
  say: 'drama-decision__say',
  do: 'drama-decision__do',
  observe: 'drama-decision__observe',
}

/** UI copy for the decision bar - exported for unit tests. */
export const DRAMA_DECISION_COPY = {
  en: {
    title: 'Your move',
    continue: 'Continue →',
    freeSubmit: 'Decide',
    freePlaceholder: 'Or type what you say, do, or notice…',
    kindSay: 'Say',
    kindDo: 'Do',
    kindObserve: 'Observe',
    unfolding: 'The scene is unfolding…',
  },
  zh: {
    title: '你的决定',
    continue: '继续推进 →',
    freeSubmit: '决定',
    freePlaceholder: '或自由输入：你要说、做、或观察到什么…',
    kindSay: '说',
    kindDo: '做',
    kindObserve: '观察',
    unfolding: '局面展开中…',
  },
} as const

export type ColdOpenSuggestionOpts = {
  choiceId?: string
  characterId?: string
}

/**
 * Cold-open suggestions for first beats.
 * Branches by cold-open choice and cast so chips match the crisis the player picked.
 */
export function buildColdOpenSuggestions(
  language: 'zh' | 'en',
  opts?: ColdOpenSuggestionOpts,
): DramaSuggestion[] {
  const choiceId = opts?.choiceId
  const isJesse = opts?.characterId === 'jesse'
  const zh = language === 'zh'

  if (choiceId === 'find_jesse') {
    if (isJesse) {
      return zh
        ? [
            {
              id: 'cold-find-say-wounds',
              kind: 'say',
              label: '检查伤势',
              payload: '我喘着气对自己说：先检查伤口，别让血把整件事暴露。',
            },
            {
              id: 'cold-find-do-hide',
              kind: 'do',
              label: '找地方藏',
              payload: '我钻进暗处藏起来，压低呼吸，等风头过去。',
            },
            {
              id: 'cold-find-observe-walter',
              kind: 'observe',
              label: '想沃尔特',
              payload: '我扫视夜色，盘算要不要打给沃尔特——他会骂我，还是会来救我？',
            },
          ]
        : [
            {
              id: 'cold-find-say-wounds',
              kind: 'say',
              label: 'Check wounds',
              payload: 'I mutter under my breath: check the wounds first. Do not bleed this whole night open.',
            },
            {
              id: 'cold-find-do-hide',
              kind: 'do',
              label: 'Find cover',
              payload: 'I duck into the dark and hide, keeping my breathing low until the heat passes.',
            },
            {
              id: 'cold-find-observe-walter',
              kind: 'observe',
              label: 'Think of Walter',
              payload: 'I scan the night and weigh calling Walter — will he chew me out, or come save me?',
            },
          ]
    }
    return zh
      ? [
          {
            id: 'cold-find-say-track',
            kind: 'say',
            label: '追问去向',
            payload: '我压低声音：杰西去哪了？谁最后看见他？别瞒我。',
          },
          {
            id: 'cold-find-do-desert',
            kind: 'do',
            label: '搜沙漠',
            payload: '我拿上手电走进沙漠，沿着脚印和轮胎印找杰西。',
          },
          {
            id: 'cold-find-observe-trail',
            kind: 'observe',
            label: '看他留下什么',
            payload: '我仔细看地上的痕迹——他是跑了，还是被人带走的？',
          },
        ]
      : [
          {
            id: 'cold-find-say-track',
            kind: 'say',
            label: 'Ask where he went',
            payload: 'I keep my voice low: Where did Jesse go? Who saw him last? Do not hold out on me.',
          },
          {
            id: 'cold-find-do-desert',
            kind: 'do',
            label: 'Search the desert',
            payload: 'I grab a flashlight and head into the desert, following footprints and tire tracks for Jesse.',
          },
          {
            id: 'cold-find-observe-trail',
            kind: 'observe',
            label: 'Read the trail',
            payload: 'I study what he left behind — did he run, or was he taken?',
          },
        ]
  }

  if (choiceId === 'clean_scene') {
    return zh
      ? [
          {
            id: 'cold-clean-say-prints',
            kind: 'say',
            label: '下令擦指纹',
            payload: '所有人听好：擦掉指纹，别留下能对上我们的东西。',
          },
          {
            id: 'cold-clean-do-cash',
            kind: 'do',
            label: '藏现金',
            payload: '我把剩下的现金藏进不显眼的地方，再检查一遍有没有散落。',
          },
          {
            id: 'cold-clean-observe-blind',
            kind: 'observe',
            label: '查死角',
            payload: '我绕着房车检查死角——有没有脚印、血渍、会被晨光照到的破绽？',
          },
        ]
      : [
          {
            id: 'cold-clean-say-prints',
            kind: 'say',
            label: 'Order a wipe',
            payload: 'Listen up: wipe every print. Leave nothing that ties us to this RV.',
          },
          {
            id: 'cold-clean-do-cash',
            kind: 'do',
            label: 'Hide the cash',
            payload: 'I stash the remaining cash somewhere quiet, then check again for loose bills.',
          },
          {
            id: 'cold-clean-observe-blind',
            kind: 'observe',
            label: 'Check blind spots',
            payload: 'I circle the RV for blind spots — footprints, blood, anything morning light would use against us.',
          },
        ]
  }

  if (choiceId === 'call_saul') {
    const isSaul = opts?.characterId === 'saul'
    // Cast as Saul: receive the call, don't dial yourself
    if (isSaul) {
      return zh
        ? [
            {
              id: 'cold-saul-say-answer',
              kind: 'say',
              label: '接电话',
              payload: '我接起电话，先稳住对方：说，出什么事了？别急，先告诉我你在哪。',
            },
            {
              id: 'cold-saul-do-price',
              kind: 'do',
              label: '谈价',
              payload: '我一边听一边盘算价码，先把律师费和风险费谈清楚再答应下一步。',
            },
            {
              id: 'cold-saul-observe-cover',
              kind: 'observe',
              label: '编说辞',
              payload: '我听对方的口气，同时在脑子里编一套能过关的说辞——等会儿怎么跟DEA、怎么跟客户圆。',
            },
          ]
        : [
            {
              id: 'cold-saul-say-answer',
              kind: 'say',
              label: 'Answer the call',
              payload: "I pick up and steady them: Talk to me. What happened? Where are you? Don't panic.",
            },
            {
              id: 'cold-saul-do-price',
              kind: 'do',
              label: 'Negotiate price',
              payload: 'I listen and start pricing the mess — lawyer fee, risk fee — before I commit to the next move.',
            },
            {
              id: 'cold-saul-observe-cover',
              kind: 'observe',
              label: 'Invent cover story',
              payload: "I read their voice and invent a cover story that can hold — for the DEA, for the client, for whoever's listening.",
            },
          ]
    }
    // Not Saul: dial Saul chips
    return zh
      ? [
          {
            id: 'cold-saul-say-dial',
            kind: 'say',
            label: '打给索尔',
            payload: '索尔，是我。沙漠出事了，我需要你现在接电话——别问为什么。',
          },
          {
            id: 'cold-saul-do-cover',
            kind: 'do',
            label: '准备说辞',
            payload: '我先编好一套能过关的说辞，再拨索尔的号码。',
          },
          {
            id: 'cold-saul-observe-lights',
            kind: 'observe',
            label: '看有没有灯',
            payload: '我一边听电话忙音，一边扫地平线——有车灯就立刻挂断。',
          },
        ]
      : [
          {
            id: 'cold-saul-say-dial',
            kind: 'say',
            label: 'Dial Saul',
            payload: "Saul, it's me. Something went wrong in the desert. I need you on the line now — do not ask why.",
          },
          {
            id: 'cold-saul-do-cover',
            kind: 'do',
            label: 'Prep cover story',
            payload: 'I lock in a cover story that can hold pressure, then dial Saul.',
          },
          {
            id: 'cold-saul-observe-lights',
            kind: 'observe',
            label: 'Watch for lights',
            payload: 'I listen to the ring and scan the horizon — if headlights show, I hang up.',
          },
        ]
  }

  if (choiceId === 'free') {
    return zh
      ? [
          {
            id: 'cold-free-say-pressure',
            kind: 'say',
            label: '先施压',
            payload: '我提高语气，逼在场的人立刻给一个明确说法。',
          },
          {
            id: 'cold-free-do-move',
            kind: 'do',
            label: '先动手',
            payload: '我不空谈，先做一个能改局面的实际动作。',
          },
          {
            id: 'cold-free-observe-room',
            kind: 'observe',
            label: '先看清',
            payload: '我先按兵不动，把风险和每个人的反应看清楚。',
          },
        ]
      : [
          {
            id: 'cold-free-say-pressure',
            kind: 'say',
            label: 'Apply pressure',
            payload: 'I raise the pressure and demand a clear answer from whoever is here.',
          },
          {
            id: 'cold-free-do-move',
            kind: 'do',
            label: 'Move first',
            payload: 'I stop talking and take one concrete move that changes the board.',
          },
          {
            id: 'cold-free-observe-room',
            kind: 'observe',
            label: 'Read the room',
            payload: 'I hold still and study every risk and reaction before I commit.',
          },
        ]
  }

  // Default: generic RV / cash crisis (no choice recorded, or unknown id)
  if (isJesse) {
    return zh
      ? [
          {
            id: 'cold-say-cash',
            kind: 'say',
            label: '报现金数',
            payload: '我自己盘一遍：我们到底还剩多少现金？别骗自己。',
          },
          {
            id: 'cold-do-rv',
            kind: 'do',
            label: '检查房车',
            payload: '我检查房车补给和设备，盘算自己还能撑多久。',
          },
          {
            id: 'cold-observe-self',
            kind: 'observe',
            label: '看自己慌不慌',
            payload: '我强迫自己冷静——我是真慌了，还是还能装镇定？',
          },
        ]
      : [
          {
            id: 'cold-say-cash',
            kind: 'say',
            label: 'Count the cash',
            payload: "I level with myself: how much cash do we actually have left? Don't lie.",
          },
          {
            id: 'cold-do-rv',
            kind: 'do',
            label: 'Check the RV',
            payload: 'I check the RV supplies and gear, figuring how long I can last out here.',
          },
          {
            id: 'cold-observe-self',
            kind: 'observe',
            label: 'Check yourself',
            payload: 'I force a breath and check myself — am I panicking, or can I still bluff calm?',
          },
        ]
  }

  return zh
    ? [
        {
          id: 'cold-say-cash',
          kind: 'say',
          label: '问现金',
          payload: '杰西，我们到底还有多少现金？别跟我绕弯子。',
        },
        {
          id: 'cold-do-rv',
          kind: 'do',
          label: '检查房车',
          payload: '我检查房车补给和设备，盘算我们还能撑多久。',
        },
        {
          id: 'cold-observe-jesse',
          kind: 'observe',
          label: '观察杰西',
          payload: '我盯着杰西看——他是真慌了，还是在装镇定？',
        },
      ]
    : [
        {
          id: 'cold-say-cash',
          kind: 'say',
          label: 'Ask about cash',
          payload: "Jesse, how much cash do we actually have? Don't dance around it.",
        },
        {
          id: 'cold-do-rv',
          kind: 'do',
          label: 'Check the RV',
          payload: 'I check the RV supplies and gear, figuring how long we can last out here.',
        },
        {
          id: 'cold-observe-jesse',
          kind: 'observe',
          label: 'Read Jesse',
          payload: 'I watch Jesse closely - is he panicking, or is he bluffing calm?',
        },
      ]
}

/**
 * Cold-open crisis chips only on beat 0.
 * beatIndex >= 1 always uses beat-pause suggestions so answered actions
 * (e.g. 接电话 after call_saul) do not linger on later pauses.
 */
export function dramaSuggestionsForBeat(
  beatIndex: number,
  language: 'zh' | 'en',
  coldOpts: ColdOpenSuggestionOpts,
  pauseHint: string,
): DramaSuggestion[] {
  if (beatIndex === 0) {
    return buildColdOpenSuggestions(language, coldOpts)
  }
  return buildBeatPauseSuggestions(language, pauseHint)
}

/**
 * Generic pressure choices for mid-beat pauses.
 * Optional contextHint is woven into payloads when provided.
 */
export function buildBeatPauseSuggestions(
  language: 'zh' | 'en',
  contextHint?: string,
): DramaSuggestion[] {
  const hint = contextHint?.trim()
  if (language === 'zh') {
    const about = hint ? `（针对：${hint}）` : ''
    return [
      {
        id: 'pause-say-pressure',
        kind: 'say',
        label: '施压追问',
        payload: hint
          ? `我直接点破压力点，逼对方表态：${hint}`
          : '我提高语气，逼对方立刻给出一个明确说法。',
      },
      {
        id: 'pause-do-act',
        kind: 'do',
        label: '先动手',
        payload: hint
          ? `我不空谈，立刻采取行动应对：${hint}`
          : '我不空谈，先采取一个能改变局面的实际动作。',
      },
      {
        id: 'pause-observe-hold',
        kind: 'observe',
        label: '先看清',
        payload: hint
          ? `我先按兵不动，仔细观察局势${about}`
          : '我先按兵不动，把每个人的反应和风险看清楚。',
      },
    ]
  }
  const about = hint ? ` (re: ${hint})` : ''
  return [
    {
      id: 'pause-say-pressure',
      kind: 'say',
      label: 'Push them',
      payload: hint
        ? `I press hard and force a clear answer about: ${hint}`
        : 'I raise the pressure and demand a clear answer right now.',
    },
    {
      id: 'pause-do-act',
      kind: 'do',
      label: 'Act first',
      payload: hint
        ? `I stop talking and take a concrete move on: ${hint}`
        : 'I stop talking and take one concrete move that changes the board.',
    },
    {
      id: 'pause-observe-hold',
      kind: 'observe',
      label: 'Hold & watch',
      payload: hint
        ? `I hold still and study the room${about}`
        : 'I hold still and study every reaction before I commit.',
    },
  ]
}

/**
 * Pure guard for free-text submit: only true when trimmed text is non-empty and not disabled.
 * Parent must use onContinue for empty / advance-without-text path.
 */
export function canSubmitFreeText(freeValue: string, disabled = false): boolean {
  return freeValue.trim().length > 0 && !disabled
}

export function DramaDecisionBar({
  language,
  suggestions,
  disabled = false,
  freeValue,
  onFreeChange,
  onPick,
  onFreeSubmit,
  onContinue,
  placeholder,
}: DramaDecisionBarProps) {
  const t = DRAMA_DECISION_COPY[language]
  const canSubmitFree = canSubmitFreeText(freeValue, disabled)

  const handleFreeSubmit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!canSubmitFree) return
    onFreeSubmit()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleFreeSubmit()
    }
  }

  return (
    <div
      className={`drama-decision${disabled ? ' drama-decision--disabled' : ''}`}
      role="region"
      aria-label={t.title}
      aria-disabled={disabled || undefined}
    >
      <div className="drama-decision__head">
        <span className="drama-decision__title">{t.title}</span>
        <button
          type="button"
          className="drama-decision__continue"
          disabled={disabled}
          onClick={() => onContinue()}
        >
          {t.continue}
        </button>
      </div>

      {disabled && (
        <p className="drama-decision__status" role="status" aria-live="polite">
          {t.unfolding}
        </p>
      )}

      <div className="drama-decision__suggestions" role="group" aria-label={t.title}>
        {suggestions.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`drama-decision__chip ${KIND_CLASS[s.kind]}`}
            data-kind={s.kind}
            disabled={disabled}
            onClick={() => onPick(s)}
            title={s.payload}
          >
            <span className="drama-decision__kind" aria-hidden="true">
              {s.kind === 'say' ? t.kindSay : s.kind === 'do' ? t.kindDo : t.kindObserve}
            </span>
            <span className="drama-decision__label">{s.label}</span>
          </button>
        ))}
      </div>

      <form className="drama-decision__free" onSubmit={handleFreeSubmit}>
        <input
          type="text"
          className="drama-decision__input"
          value={freeValue}
          onChange={(e) => onFreeChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder ?? t.freePlaceholder}
          aria-label={placeholder ?? t.freePlaceholder}
          autoComplete="off"
        />
        <button
          type="submit"
          className="drama-decision__submit"
          disabled={!canSubmitFree}
        >
          {t.freeSubmit}
        </button>
      </form>
    </div>
  )
}

export default DramaDecisionBar
