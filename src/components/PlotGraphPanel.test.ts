import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchPlotGraph } from './PlotGraphPanel.tsx'

test('fetchPlotGraph hits session plot-graph endpoint', async () => {
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
    const data = await fetchPlotGraph('s1')
    assert.equal(calls[0], '/api/session/s1/plot-graph')
    assert.equal(data.session_id, 's1')
    assert.equal(data.nodes[0].kind, 'beat')
  } finally {
    globalThis.fetch = original
  }
})
