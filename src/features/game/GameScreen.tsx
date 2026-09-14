import { pickStageBackdrop } from '../../lib/stageBackdrops.ts'
import { ActionChoices } from './components/ActionChoices.tsx'
import { ConsequenceStrip } from './components/ConsequenceStrip.tsx'
import { RunRecap } from './components/RunRecap.tsx'
import { atmosphereFor, observedPressure, resourceLines } from './playerDisplay.ts'
import type { GameHistoryItem, PlayerView } from './types.ts'
import { useGameRun } from './useGameRun.ts'

const ERROR_COPY: Record<string, string> = {
  start_failed: '这一夜还没连上。',
  act_failed: '这一步现在做不了。',
  revision_conflict: '这一步已经过时，先看眼前这一拍。',
  conflict: '这一步已经过时，先看眼前这一拍。',
}

function historyLine(item: GameHistoryItem) {
  if (item.source !== 'player') return item.text
  return (
    <>
      <span>
        第 {item.turn} 回合 · {item.label || item.action_id}
      </span>
      {item.cost_text ? <span className="night-history__cost">代价：{item.cost_text}</span> : null}
      <span>{item.text}</span>
    </>
  )
}

export type NightPlayViewProps = {
  view: PlayerView
  pending: boolean
  error: string | null
  skipMotion: boolean
  muteVoice: boolean
  mediaFailed: boolean
  historyOpen: boolean
  confirming?: boolean
  onChoose: (id: string) => void
  onRestart: () => void
  onSkipMotion: () => void
  onMuteVoice: () => void
  onMediaFail: () => void
  onToggleHistory: () => void
  onReview?: () => void
  onReplay?: () => void
  onBranch?: () => void
}

export function NightPlayView({
  view,
  pending,
  error,
  skipMotion,
  muteVoice,
  mediaFailed,
  historyOpen,
  confirming = false,
  onChoose,
  onRestart,
  onSkipMotion,
  onMuteVoice,
  onMediaFail,
  onToggleHistory,
  onReview,
  onReplay,
  onBranch,
}: NightPlayViewProps) {
  const pressure = observedPressure(view.meters)
  const resources = resourceLines(view.resources)
  const due = view.promises
  const history = (view.history ?? []).filter(
    (item) => item.source !== 'thought' && item.source !== 'monologue' && item.source !== 'intent',
  )
  const showHistory = historyOpen || Boolean(view.ending)
  const plate = pickStageBackdrop(`${view.location_label} ${view.location}`)

  return (
    <main
      className={`night${skipMotion ? ' night--static' : ''}`}
      lang="zh-CN"
      data-atmosphere={atmosphereFor(view.location_label)}
    >
      {!mediaFailed && (
        <img
          className="night-plate"
          src={plate}
          alt=""
          onError={onMediaFail}
        />
      )}
      <header className="night-chrome">
        <a className="night-home" href="/">
          回首页
        </a>
        <div className="night-tools">
          <button type="button" className="night-tool" onClick={onToggleHistory} aria-expanded={historyOpen}>
            经过
          </button>
          <details className="night-settings">
            <summary>设置</summary>
            <label>
              <input type="checkbox" checked={skipMotion} onChange={onSkipMotion} />
              跳过动画
            </label>
            <label>
              <input type="checkbox" checked={muteVoice} onChange={onMuteVoice} />
              静音旁白
            </label>
          </details>
        </div>
      </header>

      <p className="night-kicker">
        第 {view.turn} / {view.turns_max} 回合 · {view.location_label} · 你扮演 {view.player}
      </p>

      <section className="night-board" aria-label="眼前要守住的东西">
        <p>
          <span>当前目标</span>
          {view.objective}
        </p>
        <p>
          <span>即将到期的承诺</span>
          {due.length === 0
            ? '眼下没有即将到期的承诺'
            : due.map((item) =>
                item.due_turn ? `${item.label} · 第 ${item.due_turn} 回合前回来` : item.label,
              ).join('；')}
        </p>
        <p>
          <span>压力</span>
          {pressure.join(' · ')}
        </p>
        <p>
          <span>资源</span>
          {resources.join(' · ')}
        </p>
      </section>

      <section className="night-stage" aria-label="当前场景">
        {view.scene.speaker ? <p className="night-speaker">{view.scene.speaker}</p> : null}
        <p className="night-body">{view.scene.body}</p>
      </section>

      <ConsequenceStrip text={view.last_consequence} />

      {error && (
        <p className="night-error" role="alert">
          {ERROR_COPY[error] ?? '这一步现在做不了。'}
        </p>
      )}

      {confirming && (
        <p className="night-confirm" role="status" aria-live="polite">
          正在确认这一步…
        </p>
      )}

      {showHistory &&
        (history.length === 0 ? (
          <p className="night-history">这一夜还没走出第一步。</p>
        ) : (
          <ol className="night-history" aria-label="经过">
            {history.map((item, index) => (
              <li key={`${item.turn}-${item.action_id ?? item.source}-${index}`}>{historyLine(item)}</li>
            ))}
          </ol>
        ))}

      {view.ending ? (
        <RunRecap
          ending={view.ending}
          onRestart={onRestart}
          onReview={onReview}
          onReplay={onReplay}
          onBranch={onBranch}
        />
      ) : (
        <ActionChoices actions={view.legal_actions} disabled={pending} onChoose={onChoose} />
      )}
    </main>
  )
}

export function GameScreen() {
  const run = useGameRun(1)

  if (run.starting || !run.view) {
    return (
      <main className="night night--boot" lang="zh-CN">
        <p className="night-confirm" role="status">
          {run.error === 'start_failed' ? '这一夜还没连上。' : '正在开这一夜…'}
        </p>
        {run.error === 'start_failed' && (
          <button type="button" className="night-restart" onClick={run.restart}>
            再试一次
          </button>
        )}
      </main>
    )
  }

  return (
    <NightPlayView
      view={run.view}
      pending={run.pending}
      error={run.error}
      skipMotion={run.skipMotion}
      muteVoice={run.muteVoice}
      mediaFailed={run.mediaFailed}
      historyOpen={run.historyOpen}
      confirming={run.confirming}
      onChoose={run.choose}
      onRestart={run.restart}
      onSkipMotion={run.onSkipMotion}
      onMuteVoice={run.onMuteVoice}
      onMediaFail={run.onMediaFail}
      onToggleHistory={run.onToggleHistory}
      onReview={run.onReview}
      onReplay={run.onReplay}
      onBranch={run.onBranch}
    />
  )
}
