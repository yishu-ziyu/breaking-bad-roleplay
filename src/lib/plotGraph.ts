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
  const cut = t.slice(0, max)
  const punc = Math.max(
    cut.lastIndexOf('-'),
    cut.lastIndexOf('，'),
    cut.lastIndexOf('。'),
    cut.lastIndexOf('：'),
    cut.lastIndexOf(':'),
    cut.lastIndexOf(' '),
  )
  if (punc >= Math.floor(max * 0.45)) return `${cut.slice(0, punc)}…`
  return `${cut}…`
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
