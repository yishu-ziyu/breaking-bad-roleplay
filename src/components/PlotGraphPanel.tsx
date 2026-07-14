/* Situation map - past is fact, present is the door, future is fog.
   Opens only when the player asks; never auto-pop on story complete. */

import { useCallback, useEffect, useId, useMemo, useState } from 'react'

export interface PlotGraphNode {
  id: string
  kind: string
  label: string
  speak_count?: number
  known_by?: string[]
  irreversible?: boolean
  index?: number
}

export interface PlotGraphEdge {
  id: string
  source: string
  target: string
  kind: string
  label?: string
}

export interface PlotGraphData {
  session_id: string
  title: string
  task_prompt: string
  era: string
  summary: {
    beat_count?: number
    character_count?: number
    fact_count?: number
    tension_count?: number
    cost_count?: number
    spoken_lines?: number
  }
  nodes: PlotGraphNode[]
  edges: PlotGraphEdge[]
  mermaid: string
}

export type SituationMapView = {
  past: PlotGraphNode[]
  current: PlotGraphNode | null
  known: string[]
  shifting: string[]
  fog: string[]
  cast: PlotGraphNode[]
}

/** Pure reshape for the player-facing map (past / door / fog). */
export function buildSituationMap(graph: PlotGraphData | null | undefined): SituationMapView {
  if (!graph) {
    return { past: [], current: null, known: [], shifting: [], fog: [], cast: [] }
  }
  const beats = (graph.nodes ?? [])
    .filter((n) => n.kind === 'beat')
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const past = beats.length > 1 ? beats.slice(0, -1) : []
  const current = beats.length > 0 ? beats[beats.length - 1] : null
  const known = (graph.nodes ?? [])
    .filter((n) => n.kind === 'fact')
    .map((n) => n.label)
    .filter(Boolean)
  const shifting = (graph.nodes ?? [])
    .filter((n) => n.kind === 'cost')
    .map((n) => n.label)
    .filter(Boolean)
  const fogSeen = new Set<string>()
  const fog: string[] = []
  for (const e of graph.edges ?? []) {
    if (e.kind !== 'tension') continue
    const label = (e.label || '').trim()
    if (!label || fogSeen.has(label)) continue
    fogSeen.add(label)
    fog.push(label)
  }
  const cast = (graph.nodes ?? [])
    .filter((n) => n.kind === 'character')
    .sort((a, b) => (b.speak_count ?? 0) - (a.speak_count ?? 0))
  return { past, current, known, shifting, fog, cast }
}

type Labels = {
  plotNet: string
  plotNetLoad: string
  plotNetError: string
  plotNetEmpty: string
  plotNetPast: string
  plotNetNow: string
  plotNetFog: string
  plotNetKnown: string
  plotNetShifting: string
  plotNetCast: string
  plotNetHide: string
  plotNetShow: string
  plotNetHint: string
  plotNetNoPast: string
  plotNetNoFog: string
}

const DEFAULT_LABELS: Labels = {
  plotNet: 'Situation map',
  plotNetLoad: 'Reading the room…',
  plotNetError: 'Could not load the map.',
  plotNetEmpty: 'Play a few beats first - the map grows from what you lived.',
  plotNetPast: 'Already lived',
  plotNetNow: 'Current situation',
  plotNetFog: 'Unknown future',
  plotNetKnown: 'You already know',
  plotNetShifting: 'Still shifting',
  plotNetCast: 'Who spoke',
  plotNetHide: 'Close',
  plotNetShow: 'Open situation map',
  plotNetHint: 'Past is fact. Present is the door. Future is fog - only this session.',
  plotNetNoPast: 'This is where the thread starts.',
  plotNetNoFog: 'No open pressure yet - the next beat will write the fog.',
}

interface Props {
  sessionId: string | null
  open?: boolean
  onClose?: () => void
  labels?: Partial<Labels>
}

export async function fetchPlotGraph(sessionId: string): Promise<PlotGraphData> {
  const res = await fetch(`/api/session/${sessionId}/plot-graph`)
  if (!res.ok) {
    throw new Error(`plot-graph ${res.status}`)
  }
  return res.json() as Promise<PlotGraphData>
}

export function PlotGraphPanel({ sessionId, open = false, onClose, labels }: Props) {
  const t = { ...DEFAULT_LABELS, ...labels }
  const titleId = useId()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [graph, setGraph] = useState<PlotGraphData | null>(null)

  const load = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPlotGraph(sessionId)
      setGraph(data)
    } catch {
      setError(t.plotNetError)
      setGraph(null)
    } finally {
      setLoading(false)
    }
  }, [sessionId, t.plotNetError])

  useEffect(() => {
    if (!open) return
    if (!sessionId) return
    void load()
  }, [open, sessionId, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const view = useMemo(() => buildSituationMap(graph), [graph])
  const empty =
    !loading &&
    !error &&
    graph &&
    view.past.length === 0 &&
    !view.current &&
    view.cast.length === 0 &&
    view.fog.length === 0

  if (!sessionId || !open) return null

  return (
    <div
      className="situation-map-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="situation-map">
        <header className="situation-map__head">
          <div>
            <p className="situation-map__eyebrow">{t.plotNetHint}</p>
            <h2 id={titleId}>{t.plotNet}</h2>
          </div>
          <button type="button" className="situation-map__close" onClick={() => onClose?.()}>
            {t.plotNetHide}
          </button>
        </header>

        {loading && <p className="situation-map__status">{t.plotNetLoad}</p>}
        {error && <p className="situation-map__status is-error">{error}</p>}
        {empty && <p className="situation-map__status">{t.plotNetEmpty}</p>}

        {!loading && graph && !empty && (
          <>
            <div className="situation-map__meta">
              {graph.era && <span>{graph.era}</span>}
              <span>{graph.summary.beat_count ?? 0} beats</span>
              <span>{graph.summary.character_count ?? 0} cast</span>
              <span>{graph.summary.spoken_lines ?? 0} lines</span>
            </div>

            <div className="situation-map__layout">
              <section className="situation-map__col situation-map__col--past" aria-label={t.plotNetPast}>
                <h3>{t.plotNetPast}</h3>
                {view.past.length === 0 ? (
                  <p className="situation-map__muted">{t.plotNetNoPast}</p>
                ) : (
                  <ol className="situation-map__spine">
                    {view.past.map((b, i) => (
                      <li key={b.id}>
                        <span className="situation-map__node situation-map__node--past">
                          <em>{i + 1}</em>
                          {b.label}
                        </span>
                        {i < view.past.length - 1 && (
                          <span className="situation-map__rail" aria-hidden="true" />
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="situation-map__col situation-map__col--now" aria-label={t.plotNetNow}>
                <h3>{t.plotNetNow}</h3>
                <article className="situation-map__door">
                  <p className="situation-map__door-title">
                    {view.current?.label || graph.task_prompt || graph.title || '—'}
                  </p>
                  {view.known.length > 0 && (
                    <div className="situation-map__block">
                      <h4>{t.plotNetKnown}</h4>
                      <ul>
                        {view.known.slice(0, 6).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {view.shifting.length > 0 && (
                    <div className="situation-map__block">
                      <h4>{t.plotNetShifting}</h4>
                      <ul>
                        {view.shifting.slice(0, 4).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {view.cast.length > 0 && (
                    <div className="situation-map__block">
                      <h4>{t.plotNetCast}</h4>
                      <ul className="situation-map__cast">
                        {view.cast.slice(0, 8).map((c) => (
                          <li key={c.id}>
                            {c.label}
                            {typeof c.speak_count === 'number' ? ` · ${c.speak_count}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              </section>

              <section className="situation-map__col situation-map__col--fog" aria-label={t.plotNetFog}>
                <h3>{t.plotNetFog}</h3>
                {view.fog.length === 0 ? (
                  <p className="situation-map__muted">{t.plotNetNoFog}</p>
                ) : (
                  <ul className="situation-map__fog">
                    {view.fog.slice(0, 6).map((line) => (
                      <li key={line}>
                        <span className="situation-map__cloud" aria-hidden="true">
                          ☁
                        </span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
