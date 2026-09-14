import type { GameEnding } from '../types.ts'

type Props = {
  ending: GameEnding
  onRestart: () => void
  onReview?: () => void
  onReplay?: () => void
  onBranch?: () => void
}

export function RunRecap({ ending, onRestart, onReview, onReplay, onBranch }: Props) {
  return (
    <section className="night-recap" aria-labelledby="night-recap-title">
      <h2 id="night-recap-title">{ending.title}</h2>
      <p>{ending.body}</p>
      <ol>
        {ending.causes.map((cause) => (
          <li key={`${cause.turn}-${cause.action_id}`}>
            第 {cause.turn} 回合：{cause.label || cause.action_id}
          </li>
        ))}
      </ol>
      {(onReview || onReplay || onBranch) && (
        <div className="night-recap__tools">
          {onReview ? (
            <button type="button" className="night-tool" onClick={onReview}>
              回看
            </button>
          ) : null}
          {onReplay ? (
            <button type="button" className="night-tool" onClick={onReplay}>
              重演
            </button>
          ) : null}
          {onBranch ? (
            <button type="button" className="night-tool" onClick={onBranch}>
              分支
            </button>
          ) : null}
        </div>
      )}
      <button type="button" className="night-restart" onClick={onRestart}>
        再过这一夜
      </button>
    </section>
  )
}
