import type { ActionCommand, GameEvent, PlayerView } from './types.ts'

async function readJson(res: Response): Promise<unknown> {
  return res.json()
}

let inflight: Promise<PlayerView> | null = null

export async function startGame(seed = 1, options: { force?: boolean } = {}): Promise<PlayerView> {
  if (!options.force && inflight) return inflight
  const pending = (async () => {
    const res = await fetch('/api/game/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed }),
    })
    if (!res.ok) throw new Error('start_failed')
    return (await readJson(res)) as PlayerView
  })()
  inflight = pending
  try {
    return await pending
  } finally {
    if (inflight === pending) inflight = null
  }
}

export async function getGame(runId: string): Promise<PlayerView> {
  const res = await fetch(`/api/game/${runId}`)
  if (!res.ok) throw new Error('get_failed')
  return (await readJson(res)) as PlayerView
}

export async function postAction(
  runId: string,
  command: ActionCommand,
): Promise<{ view: PlayerView } | { code: string; view?: PlayerView }> {
  const res = await fetch(`/api/game/${runId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })
  const body = (await readJson(res)) as { view?: PlayerView; code?: string }
  if (res.status === 409) return { code: body.code ?? 'conflict', view: body.view }
  if (!res.ok || !body.view) throw new Error(body.code ?? 'act_failed')
  return { view: body.view }
}

export async function getEvents(runId: string, after = 0): Promise<GameEvent[]> {
  const res = await fetch(`/api/game/${runId}/events?after=${after}`)
  if (!res.ok) throw new Error('events_failed')
  const body = (await readJson(res)) as { events: GameEvent[] }
  return body.events
}

export async function branchGame(runId: string, revision: number): Promise<PlayerView> {
  const res = await fetch(`/api/game/${runId}/branches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision }),
  })
  if (!res.ok) throw new Error('branch_failed')
  return (await readJson(res)) as PlayerView
}

export async function replayRevision(
  runId: string,
  revision: number,
): Promise<{ job_id: string; revision: number; status: string }> {
  const res = await fetch(`/api/game/${runId}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision }),
  })
  if (!res.ok) throw new Error('replay_failed')
  return (await readJson(res)) as { job_id: string; revision: number; status: string }
}
