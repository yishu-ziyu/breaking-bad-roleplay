/* Situation map - a horizontal spine map, not a three-column brief.
   Past is hard nodes. Present is the door. Future is fog clouds.
   Opens only when the player asks; never auto-pop on story complete. */

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { sessionAuthHeaders } from '../hooks/useStoryStream'

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

/** Shorten a long beat title for the spine node surface. */
export function shortMapLabel(label: string, max = 28): string {
  const t = (label || '').trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  // Prefer cut at Chinese punctuation or dash
  const cut = t.slice(0, max)
  const punc = Math.max(cut.lastIndexOf('-'), cut.lastIndexOf('，'), cut.lastIndexOf('。'), cut.lastIndexOf('：'), cut.lastIndexOf(':'), cut.lastIndexOf(' '))
  if (punc >= Math.floor(max * 0.45)) return `${cut.slice(0, punc)}…`
  return `${cut}…`
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
  plotNetBeats: string
  plotNetCastMeta: string
  plotNetLines: string
  plotNetNowTag: string
  plotNetFogTag: string
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
  plotNetBeats: 'beats',
  plotNetCastMeta: 'cast',
  plotNetLines: 'lines',
  plotNetNowTag: 'NOW',
  plotNetFogTag: 'FOG',
}

interface Props {
  sessionId: string | null
  open?: boolean
  onClose?: () => void
  labels?: Partial<Labels>
  language?: 'zh' | 'en'
}

export async function fetchPlotGraph(
  sessionId: string,
  language: 'zh' | 'en' = 'en',
): Promise<PlotGraphData> {
  const res = await fetch(`/api/session/${sessionId}/plot-graph?language=${encodeURIComponent(language)}`, {
    headers: { ...sessionAuthHeaders() },
  })
  if (!res.ok) {
    throw new Error(`plot-graph ${res.status}`)
  }
  return res.json() as Promise<PlotGraphData>
}

export function PlotGraphPanel({
  sessionId,
  open = false,
  onClose,
  labels,
  language = 'en',
}: Props) {
  const t = { ...DEFAULT_LABELS, ...labels }
  const titleId = useId()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [graph, setGraph] = useState<PlotGraphData | null>(null)
  const [selectedFog, setSelectedFog] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPlotGraph(sessionId, language)
      setGraph(data)
    } catch {
      setError(t.plotNetError)
      setGraph(null)
    } finally {
      setLoading(false)
    }
  }, [sessionId, language, t.plotNetError])

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

  const doorTitle =
    view.current?.label || graph?.task_prompt || graph?.title || '-'
  const doorShort = shortMapLabel(doorTitle, language === 'zh' ? 22 : 32)

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
              <span>
                {graph.summary.beat_count ?? 0} {t.plotNetBeats}
              </span>
              <span>
                {graph.summary.character_count ?? 0} {t.plotNetCastMeta}
              </span>
              <span>
                {graph.summary.spoken_lines ?? 0} {t.plotNetLines}
              </span>
            </div>

            {/* Horizontal spine map: past stations -> NOW door -> fog clouds */}
            <div className="situation-map__canvas" aria-label={t.plotNet}>
              <div className="situation-map__track">
                <div className="situation-map__track-line" aria-hidden="true" />

                <div className="situation-map__stations">
                  {view.past.length === 0 ? (
                    <div className="situation-map__station situation-map__station--ghost">
                      <span className="situation-map__dot situation-map__dot--ghost" />
                      <span className="situation-map__station-label">{t.plotNetNoPast}</span>
                    </div>
                  ) : (
                    view.past.map((b, i) => (
                      <div key={b.id} className="situation-map__station situation-map__station--past">
                        <span className="situation-map__dot situation-map__dot--past" aria-hidden="true">
                          {i + 1}
                        </span>
                        <span className="situation-map__station-label" title={b.label}>
                          {shortMapLabel(b.label, language === 'zh' ? 18 : 26)}
                        </span>
                      </div>
                    ))
                  )}

                  <div className="situation-map__station situation-map__station--now">
                    <span className="situation-map__dot situation-map__dot--now" aria-hidden="true">
                      {t.plotNetNowTag}
                    </span>
                    <span className="situation-map__station-label situation-map__station-label--now" title={doorTitle}>
                      {doorShort}
                    </span>
                  </div>

                  <div className="situation-map__station situation-map__station--fog-head">
                    <span className="situation-map__dot situation-map__dot--fog" aria-hidden="true">
                      {t.plotNetFogTag}
                    </span>
                    <span className="situation-map__station-label situation-map__station-label--fog">
                      {t.plotNetFog}
                    </span>
                  </div>
                </div>
              </div>

              {/* Fog branch fan under the fog head */}
              <div className="situation-map__fog-fan" aria-label={t.plotNetFog}>
                {view.fog.length === 0 ? (
                  <p className="situation-map__muted">{t.plotNetNoFog}</p>
                ) : (
                  view.fog.slice(0, 5).map((line, i) => (
                    <button
                      key={line}
                      type="button"
                      className={`situation-map__cloud-card${selectedFog === line ? ' is-active' : ''}`}
                      style={{ ['--fog-i' as string]: String(i) }}
                      onClick={() => setSelectedFog((cur) => (cur === line ? null : line))}
                    >
                      <span className="situation-map__cloud-glyph" aria-hidden="true" />
                      <span>{shortMapLabel(line, language === 'zh' ? 36 : 48)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Situation card under the map - current door details */}
            <article className="situation-map__door-card">
              <header>
                <p className="situation-map__door-kicker">{t.plotNetNow}</p>
                <h3>{doorTitle}</h3>
              </header>

              <div className="situation-map__door-grid">
                {view.known.length > 0 && (
                  <div className="situation-map__block">
                    <h4>{t.plotNetKnown}</h4>
                    <ul>
                      {view.known.slice(0, 5).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(view.shifting.length > 0 || selectedFog) && (
                  <div className="situation-map__block">
                    <h4>{selectedFog ? t.plotNetFog : t.plotNetShifting}</h4>
                    {selectedFog ? (
                      <p className="situation-map__selected-fog">{selectedFog}</p>
                    ) : (
                      <ul>
                        {view.shifting.slice(0, 4).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {view.cast.length > 0 && (
                  <div className="situation-map__block situation-map__block--cast">
                    <h4>{t.plotNetCast}</h4>
                    <ul className="situation-map__cast">
                      {view.cast
                        .filter((c) => (c.speak_count ?? 0) > 0 || view.cast.length <= 4)
                        .slice(0, 8)
                        .map((c) => (
                          <li key={c.id}>
                            {c.label}
                            {typeof c.speak_count === 'number' && c.speak_count > 0
                              ? ` · ${c.speak_count}`
                              : ''}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            </article>
          </>
        )}
      </div>
    </div>
  )
}
