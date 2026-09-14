import type { PlayerView } from '../contracts.ts'

const METER_LABEL: Record<string, string> = {
  police_risk: '风声',
  family_strain: '家里',
  jesse_trust: '杰西',
}

const RESOURCE_LABEL: Record<string, string> = {
  cash: '现金',
  saul_favor: '人情',
}

type Props = { view: PlayerView }

export function ScenePanel({ view }: Props) {
  return (
    <section className="night-scene" aria-labelledby="night-scene-title">
      <p className="night-kicker">
        第 {view.turn} / {view.turns_max} 回合 · {view.location_label} · 你扮演 {view.player}
      </p>
      <h1 id="night-scene-title" className="night-objective">
        {view.objective}
      </h1>
      <ul className="night-meters" aria-label="已经观察到的压力">
        {Object.entries(view.meters).map(([key, value]) => (
          <li key={key}>
            <span>{METER_LABEL[key] ?? key}</span>
            <strong>{value}</strong>
          </li>
        ))}
      </ul>
      <ul className="night-resources" aria-label="剩余资源">
        {Object.entries(view.resources).map(([key, value]) => (
          <li key={key}>
            <span>{RESOURCE_LABEL[key] ?? key}</span>
            <strong>{value}</strong>
          </li>
        ))}
      </ul>
      {view.promises.length > 0 && (
        <ul className="night-promises" aria-label="即将到期的承诺">
          {view.promises.map((item) => (
            <li key={item.id}>
              {item.label}
              {item.due_turn ? ` · 第 ${item.due_turn} 回合前回来` : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="night-stage">
        {view.scene.speaker ? <p className="night-speaker">{view.scene.speaker}</p> : null}
        <p className="night-body">{view.scene.body}</p>
      </div>
    </section>
  )
}
