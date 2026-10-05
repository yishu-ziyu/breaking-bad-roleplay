import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import {
  relationPrototypeLabel,
  relationPrototypeSelectedWord,
  type RelationProtoLanguage,
} from '../lib/relationPrototype'

export type RelationPillsProps = {
  prefix: string
  options: string[]
  value: string
  locked: boolean
  language: RelationProtoLanguage
  labels: Record<string, string>
  explanations: Record<string, string>
  lockHint: string
  onChange: (value: string) => void
}

export function RelationPills({
  prefix,
  options,
  value,
  locked,
  language,
  labels,
  explanations,
  lockHint,
  onChange,
}: RelationPillsProps) {
  const selectedWord = relationPrototypeSelectedWord(language)
  const groupLabel = relationPrototypeLabel(language)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const move = (from: string, delta: number) => {
    if (options.length === 0) return
    const current = Math.max(0, options.indexOf(from))
    const next = options[(current + delta + options.length) % options.length]
    onChange(next)
    const nextIndex = options.indexOf(next)
    queueMicrotask(() => itemRefs.current[nextIndex]?.focus())
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      move(value, 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(value, -1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      onChange(options[0])
      queueMicrotask(() => itemRefs.current[0]?.focus())
    } else if (event.key === 'End') {
      event.preventDefault()
      onChange(options[options.length - 1])
      queueMicrotask(() => itemRefs.current[options.length - 1]?.focus())
    }
  }

  return (
    <div className="relation-pills" data-relation-prototype="true">
      <p className="relation-pills__prefix">{prefix}</p>
      {locked ? (
        <div className="relation-pills__locked" role="status">
          <p className="relation-pills__locked-line">
            <span className="relation-pills__chosen">{selectedWord}</span>
            {labels[value] ?? value}
          </p>
          <p className="relation-pills__lock-hint">{lockHint}</p>
        </div>
      ) : (
        <div
          className="relation-pills__group"
          role="radiogroup"
          aria-label={groupLabel}
          onKeyDown={onKeyDown}
        >
          {options.map((option, index) => {
            const selected = option === value
            const label = labels[option] ?? option
            return (
              <button
                key={option}
                ref={(node) => { itemRefs.current[index] = node }}
                type="button"
                role="radio"
                className={selected ? 'relation-pills__option is-selected' : 'relation-pills__option'}
                aria-checked={selected}
                aria-label={selected ? `${label} · ${selectedWord}` : label}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(option)}
              >
                <span className="relation-pills__row">
                  {selected ? <span className="relation-pills__chosen">{selectedWord}</span> : null}
                  <span className="relation-pills__name">{label}</span>
                </span>
                <span className="relation-pills__explain">{explanations[option] ?? ''}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default RelationPills
