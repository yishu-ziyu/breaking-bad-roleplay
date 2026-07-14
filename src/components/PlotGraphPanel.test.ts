import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSituationMap,
  fetchPlotGraph,
  shortMapLabel,
  type PlotGraphData,
} from './PlotGraphPanel.tsx'

test('fetchPlotGraph hits session plot-graph endpoint with language', async () => {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    return new Response(
      JSON.stringify({
        session_id: 's1',
        title: 't',
        task_prompt: 'p',
        era: 's3_mid',
        summary: { beat_count: 1 },
        nodes: [{ id: 'beat_0', kind: 'beat', label: 'Lab', index: 0 }],
        edges: [],
        mermaid: 'flowchart LR',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch
  try {
    const data = await fetchPlotGraph('s1', 'zh')
    assert.equal(calls[0], '/api/session/s1/plot-graph?language=zh')
    assert.equal(data.session_id, 's1')
    assert.equal(data.nodes[0].kind, 'beat')
  } finally {
    globalThis.fetch = original
  }
})

test('buildSituationMap splits past / current / fog without inventing futures', () => {
  const graph: PlotGraphData = {
    session_id: 's1',
    title: 'Cook night',
    task_prompt: 'Argue about the next cook',
    era: 's3_mid',
    summary: { beat_count: 3, character_count: 2, spoken_lines: 4 },
    nodes: [
      { id: 'beat_0', kind: 'beat', label: 'Lab argument', index: 0 },
      { id: 'beat_1', kind: 'beat', label: 'Roof silence', index: 1 },
      { id: 'beat_2', kind: 'beat', label: 'Partner starts to doubt you', index: 2 },
      { id: 'fact_1', kind: 'fact', label: 'Cargo count does not match' },
      { id: 'cost_0', kind: 'cost', label: 'Trust down' },
      { id: 'char_walter', kind: 'character', label: 'Walter', speak_count: 3 },
      { id: 'char_jesse', kind: 'character', label: 'Jesse', speak_count: 1 },
    ],
    edges: [
      {
        id: 'ten_1',
        source: 'char_walter',
        target: 'char_jesse',
        kind: 'tension',
        label: 'Loyalty is being spent as a resource',
      },
      {
        id: 'ten_1b',
        source: 'char_jesse',
        target: 'char_walter',
        kind: 'tension',
        label: 'Loyalty is being spent as a resource',
      },
      {
        id: 'ten_2',
        source: 'char_walter',
        target: 'char_walter',
        kind: 'tension',
        label: 'Police heat rising',
      },
    ],
    mermaid: 'flowchart LR',
  }
  const view = buildSituationMap(graph)
  assert.deepEqual(
    view.past.map((b) => b.label),
    ['Lab argument', 'Roof silence'],
  )
  assert.equal(view.current?.label, 'Partner starts to doubt you')
  assert.deepEqual(view.known, ['Cargo count does not match'])
  assert.deepEqual(view.shifting, ['Trust down'])
  assert.deepEqual(view.fog, [
    'Loyalty is being spent as a resource',
    'Police heat rising',
  ])
  assert.equal(view.cast[0].label, 'Walter')
})

test('buildSituationMap handles empty graph', () => {
  const view = buildSituationMap(null)
  assert.equal(view.current, null)
  assert.equal(view.past.length, 0)
  assert.equal(view.fog.length, 0)
})

test('shortMapLabel truncates without inventing content', () => {
  assert.equal(shortMapLabel('短'), '短')
  const long = '洛斯波洛斯兄弟快餐办公室 - 古斯与沃尔特正面对峙：古斯以冷漠的礼貌邀请沃尔特坐下'
  const out = shortMapLabel(long, 18)
  assert.ok(out.length <= 19)
  assert.ok(out.endsWith('…') || out.length <= 18)
})
