import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { playAction, startGame } from './api'
import type { GameAction, GameEffect, GameResponse, Language } from './types'
import './GameKernelApp.css'

const DEFAULT_SEED = 59

const copy = {
  en: {
    kicker: 'One night · Walter · 6 turns',
    title: 'The RV is still out there',
    play: 'Begin the night',
    seed: 'Seed',
    restart: 'New night',
    legacy: 'Legacy lab',
    meters: {
      police_risk: 'Police risk',
      family_suspicion: 'Family suspicion',
      jesse_trust: 'Jesse trust',
      cash: 'Cash',
      saul_favor: 'Saul favor',
    },
    turn: 'Turn',
    dawn: 'until dawn',
    actions: 'What do you do',
    cost: 'Cost',
    effects: 'What changed',
    npcs: 'While you were busy',
    debts: 'Old trouble',
    noDebts: 'No debts came due.',
    ending: 'The night ends',
    offline: 'No AI required. The kernel already settled this turn.',
    error: 'The night stalled.',
  },
  zh: {
    kicker: '一个夜晚 · 沃尔特 · 6 回合',
    title: '房车还在外面',
    play: '进入这一夜',
    seed: '种子',
    restart: '再来一夜',
    legacy: '旧实验室',
    meters: {
      police_risk: '警察风险',
      family_suspicion: '家庭怀疑',
      jesse_trust: '杰西信任',
      cash: '现金',
      saul_favor: '索尔人情',
    },
    turn: '回合',
    dawn: '距天亮',
    actions: '你怎么做',
    cost: '代价',
    effects: '结算',
    npcs: '你不在的时候',
    debts: '旧麻烦',
    noDebts: '这一回合没有旧债到期。',
    ending: '夜结束了',
    offline: '不需要 AI。这一回合已经由规则结算。',
    error: '这一夜卡住了。',
  },
} as const

function localized(action: GameAction, lang: Language): { label: string; summary: string } {
  return {
    label: lang === 'zh' && action.label_zh ? action.label_zh : action.label,
    summary: lang === 'zh' && action.summary_zh ? action.summary_zh : (action.summary ?? ''),
  }
}

function formatCost(action: GameAction): string {
  const costs = action.costs ?? {}
  const parts = Object.entries(costs)
    .filter(([, value]) => Number(value) !== 0)
    .map(([key, value]) => `${key} -${value}`)
  return parts.join(' · ')
}

function formatEffect(effect: GameEffect): string | null {
  if (effect.field && typeof effect.delta === 'number') {
    const sign = effect.delta > 0 ? '+' : ''
    return `${effect.field} ${sign}${effect.delta}`
  }
  if (effect.remove) return `cleared ${effect.remove}`
  if (effect.debt_id) return `debt ${effect.debt_id}`
  if (effect.add) return `flag ${effect.add}`
  return null
}

export default function GameKernelApp() {
  const [lang, setLang] = useState<Language>('en')
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [game, setGame] = useState<GameResponse | null>(null)

  const t = copy[lang]
  const state = game?.next_state ?? game?.state

  const start = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setGame(await startGame(seed, lang))
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error)
    } finally {
      setBusy(false)
    }
  }, [lang, seed, t.error])

  const boot = useRef(false)
  useEffect(() => {
    if (boot.current) return
    boot.current = true
    void start()
  }, [start])

  const onAction = async (actionId: string) => {
    if (!game || busy || state?.ended) return
    setBusy(true)
    setError(null)
    try {
      setGame(await playAction(game.game_id, actionId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error)
    } finally {
      setBusy(false)
    }
  }

  const event = game?.next_event ?? game?.event
  const eventTitle = lang === 'zh' ? event?.title_zh || event?.title : event?.title
  const eventText = lang === 'zh' ? event?.text_zh || event?.text : event?.text
  const ending = game?.ending ?? state?.ending ?? null
  const effects = useMemo(
    () => (game?.resolved_effects ?? []).map(formatEffect).filter(Boolean) as string[],
    [game],
  )

  return (
    <div className="gk">
      <header className="gk-top">
        <div>
          <p className="gk-kicker">{t.kicker}</p>
          <h1>{t.title}</h1>
        </div>
        <div className="gk-tools">
          <label>
            {t.seed}
            <input
              type="number"
              value={seed}
              min={0}
              onChange={event => setSeed(Number(event.target.value) || 0)}
            />
          </label>
          <button type="button" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>
            {lang === 'en' ? '中文' : 'EN'}
          </button>
          <button type="button" onClick={() => void start()} disabled={busy}>
            {t.restart}
          </button>
          <a className="gk-legacy" href="/?legacy=1">{t.legacy}</a>
        </div>
      </header>

      {error ? <p className="gk-error" role="alert">{error}</p> : null}

      {state ? (
        <>
          <section className="gk-meters" aria-label="pressure">
            {(['police_risk', 'family_suspicion', 'jesse_trust'] as const).map(key => (
              <div key={key} className="gk-meter">
                <span>{t.meters[key]}</span>
                <strong>{state[key]} / 6</strong>
                <i style={{ width: `${(state[key] / 6) * 100}%` }} />
              </div>
            ))}
            <div className="gk-resources">
              <span>{t.meters.cash} {state.cash}</span>
              <span>{t.meters.saul_favor} {state.saul_favor}</span>
              <span>{t.turn} {state.turn} / 6</span>
            </div>
          </section>

          <section className="gk-scene">
            <p className="gk-kicker">{eventTitle}</p>
            <p className="gk-scene-text">{eventText}</p>
            {game?.performance?.reply_text ? (
              <blockquote>
                <p>{game.performance.reply_text}</p>
                {game.performance.stage_direction ? <cite>{game.performance.stage_direction}</cite> : null}
              </blockquote>
            ) : null}
            <p className="gk-note">{t.offline}</p>
          </section>

          {game?.action ? (
            <section className="gk-log">
              <div>
                <h2>{t.effects}</h2>
                <ul>
                  {effects.map(item => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div>
                <h2>{t.npcs}</h2>
                <ul>
                  {(game.npc_actions ?? []).map(npc => (
                    <li key={`${npc.npc_id}-${npc.action_id}`}>
                      <strong>{npc.npc_id}</strong> {npc.summary}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h2>{t.debts}</h2>
                {(game.triggered_debts ?? []).length === 0 ? (
                  <p>{t.noDebts}</p>
                ) : (
                  <ul>
                    {(game.triggered_debts ?? []).map(debt => (
                      <li key={debt.id}>{debt.id}: {debt.summary}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ) : null}

          {ending ? (
            <section className={`gk-ending gk-ending--${ending.kind}`}>
              <p className="gk-kicker">{t.ending} · {ending.kind}</p>
              <h2>{lang === 'zh' ? ending.title_zh || ending.title : ending.title}</h2>
              <p>{lang === 'zh' ? ending.text_zh || ending.text : ending.text}</p>
            </section>
          ) : (
            <section className="gk-actions">
              <h2>{t.actions}</h2>
              <div className="gk-action-grid">
                {(game?.available_actions ?? []).map(action => {
                  const text = localized(action, lang)
                  const cost = formatCost(action)
                  return (
                    <button
                      key={action.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void onAction(action.id)}
                    >
                      <strong>{text.label}</strong>
                      {cost ? <em>{t.cost}: {cost}</em> : <em>{t.cost}: time</em>}
                      <span>{text.summary}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </>
      ) : null}
    </div>
  )
}
