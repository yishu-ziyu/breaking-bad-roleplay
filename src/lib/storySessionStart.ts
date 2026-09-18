/* POST /api/session/create — one request shape, one classified result.
 *
 * Extracted from useStoryStream.startStory so the failure path is testable
 * without a browser: a 5xx / network error must come back as a classified
 * failure (kind + status + readable detail), never as a thrown string or
 * "[object Object]" from an object-shaped `detail`.
 */

import type { StoryFailure } from './storyFailureCopy'

export type StorySessionStartResult =
  | {
      ok: true
      sessionId: string
      sessionKey: string | null
      runtimeVersion: 0 | 1
      worldRevision: number
      commandId: string | null
    }
  | { ok: false; status: number | null; detail: string | null }

export interface CreateStorySessionOptions {
  taskPrompt: string
  characterId: string
  language: string
  scenarioId?: 'conversation' | 'desert_crisis'
  /** Session / auth headers from the caller (never secrets in the query). */
  extraHeaders?: Record<string, string>
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

/** Pull the human-readable part out of a FastAPI error body.
 * `{"detail": "..."}`, `{"detail": {"code","message"}}` and `{"message": …}`
 * all reduce to a string; anything else yields null. */
export async function readFailureDetail(res: Response): Promise<string | null> {
  const body = await res.json().catch(() => null) as unknown
  if (!body || typeof body !== 'object') return null
  const record = body as { detail?: unknown; message?: unknown }
  if (typeof record.detail === 'string') return record.detail
  if (typeof record.message === 'string') return record.message
  if (record.detail && typeof record.detail === 'object') {
    const nested = record.detail as { message?: unknown; code?: unknown }
    if (typeof nested.message === 'string') return nested.message
    if (typeof nested.code === 'string') return nested.code
  }
  return null
}

export async function createStorySession(
  opts: CreateStorySessionOptions,
): Promise<StorySessionStartResult> {
  const fetchFn = opts.fetchImpl ?? fetch
  try {
    const res = await fetchFn('/api/session/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        title: opts.taskPrompt.slice(0, 80),
        task_prompt: opts.taskPrompt,
        active_character_id: opts.characterId,
        language: opts.language,
        scenario_id: opts.scenarioId ?? 'conversation',
      }),
    })
    if (!res.ok) {
      return { ok: false, status: res.status, detail: await readFailureDetail(res) }
    }
    const data = await res.json() as Record<string, unknown>
    const sessionId = typeof data.session_id === 'string' ? data.session_id : ''
    if (!sessionId) {
      // A 200 without a session id is still a failed start: there is nothing
      // to stream and no way for the player to retry knowingly.
      return { ok: false, status: res.status, detail: 'Session creation returned no session id' }
    }
    return {
      ok: true,
      sessionId,
      sessionKey: typeof data.session_key === 'string' ? data.session_key : null,
      runtimeVersion: data.runtime_version === 1 ? 1 : 0,
      worldRevision: typeof data.world_revision === 'number' ? data.world_revision : 0,
      commandId: typeof data.command_id === 'string' ? data.command_id : null,
    }
  } catch (e) {
    return {
      ok: false,
      status: null,
      detail: e instanceof Error ? e.message : null,
    }
  }
}

/** Map a failed start into the shared failure shape the UI renders. */
export function sessionFailureFromStart(
  result: StorySessionStartResult,
): StoryFailure | null {
  if (result.ok) return null
  return { kind: 'session_create', status: result.status, detail: result.detail }
}
