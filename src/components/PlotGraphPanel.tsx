/* Personal plot graph panel - session-unique story net after play. */

import { useCallback, useEffect, useState } from 'react'

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

type Labels = {
  plotNet: string
  plotNetLoad: string
  plotNetError: string
  plotNetEmpty: string
  plotNetSpine: string
  plotNetTensions: string
  plotNetCast: string
  plotNetFacts: string
  plotNetCosts: string
  plotNetHide: string
  plotNetShow: string
  plotNetHint: string
}

const DEFAULT_LABELS: Labels = {
  plotNet: 'Your plot net',
  plotNetLoad: 'Loading plot net…',
  plotNetError: 'Could not load plot net.',
  plotNetEmpty: 'Play a few beats first - the net grows from what you lived.',
  plotNetSpine: 'Time spine',
  plotNetTensions: 'Live tensions',
  plotNetCast: 'Who spoke',
  plotNetFacts: 'Room facts',
  plotNetCosts: 'Costs paid',
  plotNetHide: 'Hide net',
  plotNetShow: 'Show plot net',
  plotNetHint: 'Built only from this session - your spine, co-presence, and what each mouth knew.',
}

interface Props {
  sessionId: string | null
  open?: boolean
  labels?: Partial<Labels>
}

export async function fetchPlotGraph(sessionId: string): Promise<PlotGraphData> {
  const res = await fetch(`/api/session/${sessionId}/plot-graph`)
  if (!res.ok) {
    throw new Error(`plot-graph ${res.status}`)
  }
  return res.json() as Promise<PlotGraphData>
}

export function PlotGraphPanel({ sessionId, open = false, labels }: Props) {
  const t = { ...DEFAULT_LABELS, ...labels }
  const [expanded, setExpanded] = useState(open)
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
    if (expanded && sessionId && !graph && !loading) {
      void load()
    }
  }, [expanded, sessionId, graph, loading, load])

  if (!sessionId) return null

  const beats = (graph?.nodes ?? []).filter((n) => n.kind === 'beat')
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const chars = (graph?.nodes ?? []).filter((n) => n.kind === 'character')
  const facts = (graph?.nodes ?? []).filter((n) => n.kind === 'fact')
  const costs = (graph?.nodes ?? []).filter((n) => n.kind === 'cost')
  const tensions = (graph?.edges ?? []).filter((e) => e.kind === 'tension')

  return (
    <div className={`plot-graph${expanded ? ' is-open' : ''}`}>
      <div className="plot-graph__header">
        <strong>{t.plotNet}</strong>
        <button
          type="button"
          className="plot-graph__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t.plotNetHide : t.plotNetShow}
        </button>
      </div>
      {expanded && (
        <div className="plot-graph__body">
          <p className="plot-graph__hint">{t.plotNetHint}</p>
          {loading && <p className="plot-graph__status">{t.plotNetLoad}</p>}
          {error && <p className="plot-graph__status is-error">{error}</p>}
          {!loading && !error && graph && beats.length === 0 && chars.length === 0 && (
            <p className="plot-graph__status">{t.plotNetEmpty}</p>
          )}
          {!loading && graph && (
            <>
              <div className="plot-graph__meta">
                <span>{graph.era}</span>
                <span>{graph.summary.beat_count ?? 0} beats</span>
                <span>{graph.summary.character_count ?? 0} cast</span>
                <span>{graph.summary.spoken_lines ?? 0} lines</span>
              </div>
              {beats.length > 0 && (
                <section className="plot-graph__section">
                  <h4>{t.plotNetSpine}</h4>
                  <ol className="plot-graph__spine">
                    {beats.map((b) => (
                      <li key={b.id}>{b.label}</li>
                    ))}
                  </ol>
                </section>
              )}
              {chars.length > 0 && (
                <section className="plot-graph__section">
                  <h4>{t.plotNetCast}</h4>
                  <ul className="plot-graph__chips">
                    {chars.map((c) => (
                      <li key={c.id}>
                        {c.label}
                        {typeof c.speak_count === 'number' ? ` · ${c.speak_count}` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {tensions.length > 0 && (
                <section className="plot-graph__section">
                  <h4>{t.plotNetTensions}</h4>
                  <ul className="plot-graph__list">
                    {tensions.map((e) => (
                      <li key={e.id}>{e.label || e.kind}</li>
                    ))}
                  </ul>
                </section>
              )}
              {facts.length > 0 && (
                <section className="plot-graph__section">
                  <h4>{t.plotNetFacts}</h4>
                  <ul className="plot-graph__list">
                    {facts.slice(0, 8).map((f) => (
                      <li key={f.id}>{f.label}</li>
                    ))}
                  </ul>
                </section>
              )}
              {costs.length > 0 && (
                <section className="plot-graph__section">
                  <h4>{t.plotNetCosts}</h4>
                  <ul className="plot-graph__list">
                    {costs.map((c) => (
                      <li key={c.id}>{c.label}</li>
                    ))}
                  </ul>
                </section>
              )}
              {graph.mermaid && (
                <details className="plot-graph__mermaid">
                  <summary>Mermaid</summary>
                  <pre>{graph.mermaid}</pre>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
