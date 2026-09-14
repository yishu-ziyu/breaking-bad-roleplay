import type { GameActionChoice } from '../types.ts'

type Props = {
  actions: GameActionChoice[]
  disabled?: boolean
  onChoose: (id: string) => void
}

export function ActionChoices({ actions, disabled = false, onChoose }: Props) {
  return (
    <div className="night-actions" role="group" aria-label="可选行动">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="night-action"
          disabled={disabled}
          onClick={() => onChoose(action.id)}
        >
          <span className="night-action__label">{action.label}</span>
          <span className="night-action__cost">{action.cost_text}</span>
        </button>
      ))}
    </div>
  )
}
