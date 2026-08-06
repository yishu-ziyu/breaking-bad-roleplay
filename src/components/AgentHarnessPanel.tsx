/* Minimal try surface for book-aligned Agent Harness API.
   Calls POST /api/agent/run + GET capabilities / lessons / trajectories.
   Self-contained floating drawer — does not touch chat/story state. */

import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'

type Language = 'zh' | 'en'
type HarnessMode = 'direct' | 'crew'
type CharacterId =
  | 'walter'
  | 'jesse'
  | 'skyler'
  | 'saul'
  | 'mike'
  | 'gus'
  | 'hank'
  | 'marie'

const CHARACTERS: { id: CharacterId; label: string }[] = [
  { id: 'walter', label: 'Walter' },
  { id: 'jesse', label: 'Jesse' },
  { id: 'skyler', label: 'Skyler' },
  { id: 'saul', label: 'Saul' },
  { id: 'mike', label: 'Mike' },
  { id: 'gus', label: 'Gus' },
  { id: 'hank', label: 'Hank' },
  { id: 'marie', label: 'Marie' },
]

/** Prefer VITE_API_URL when set; otherwise same-origin /api (Vite proxy / Vercel rewrite). */
function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function pickReply(data: Record<string, unknown> | null): string {
  if (!data) return ''
  for (const key of ['reply', 'final_text', 'text', 'message', 'content'] as const) {
    const v = data[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  return ''
}

function formatField(value: unknown): string {
  if (value == null) return '-'
  if (typeof value === 'string') return value || '-'
  if (Array.isArray(value)) {
    if (value.length === 0) return '-'
    if (value.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return value.join(', ')
    }
    return prettyJson(value)
  }
  return prettyJson(value)
}

function summarizeSteps(steps: unknown): string {
  if (!Array.isArray(steps) || steps.length === 0) return '-'
  return steps
    .map((step, i) => {
      const rec = asRecord(step)
      if (!rec) return `${i + 1}. ${String(step)}`
      const kind = typeof rec.kind === 'string' ? rec.kind : 'step'
      const tool = typeof rec.tool_name === 'string' ? ` · ${rec.tool_name}` : ''
      const content =
        typeof rec.content === 'string'
          ? rec.content
          : typeof rec.tool_result === 'string'
            ? rec.tool_result
            : ''
      const snippet = content.replace(/\s+/g, ' ').trim().slice(0, 120)
      return `${i + 1}. [${kind}${tool}] ${snippet || '…'}`
    })
    .join('\n')
}

async function parseResponseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { raw_text: text }
  }
}

function errorDetail(parsed: unknown, res: Response, fallbackText = ''): string {
  const rec = asRecord(parsed)
  const detail = rec?.detail ?? rec?.error ?? rec?.message ?? (fallbackText || res.statusText)
  return formatField(detail)
}

export type AgentHarnessPanelProps = {
  language?: Language
}

export function AgentHarnessPanel({ language = 'zh' }: AgentHarnessPanelProps) {
  const zh = language === 'zh'
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState(
    zh
      ? 'Hank 突然来访，你怎么应对？'
      : 'Hank just showed up. How do you handle it?',
  )
  const [character, setCharacter] = useState<CharacterId>('walter')
  const [mode, setMode] = useState<HarnessMode>('direct')
  const [lang, setLang] = useState<Language>(language)
  const [offline, setOffline] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState<unknown>(null)
  const [activeAction, setActiveAction] = useState<string | null>(null)

  const data = asRecord(raw)
  const reply = pickReply(data)
  const skillsUsed = data?.skills_used
  const statusBar = data?.status_bar
  const bookCoverage = data?.book_coverage
  const steps = data?.steps

  const getJson = useCallback(async (action: string, path: string) => {
    setLoading(true)
    setError(null)
    setActiveAction(action)
    try {
      const res = await fetch(apiUrl(path), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      const parsed = await parseResponseBody(res)
      if (!res.ok) {
        setRaw(parsed ?? { status: res.status })
        setError(`${action} failed (${res.status}): ${errorDetail(parsed, res)}`)
        return
      }
      setRaw(parsed)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRaw(null)
      setError(`${action} error: ${msg}`)
    } finally {
      setLoading(false)
      setActiveAction(null)
    }
  }, [])

  const postRun = useCallback(async () => {
    // Matches backend AgentHarnessService.run + capabilities_payload.try.example
    const body = {
      message: message.trim(),
      character_id: character,
      mode,
      language: lang,
      offline,
    }
    setLoading(true)
    setError(null)
    setActiveAction('run')
    try {
      const res = await fetch(apiUrl('/api/agent/run'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const parsed = await parseResponseBody(res)
      if (!res.ok) {
        setRaw(parsed ?? { status: res.status })
        setError(`run failed (${res.status}): ${errorDetail(parsed, res)}`)
        return
      }
      setRaw(parsed)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRaw(null)
      setError(`run error: ${msg}`)
    } finally {
      setLoading(false)
      setActiveAction(null)
    }
  }, [message, character, mode, lang, offline])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!message.trim() || loading) return
    void postRun()
  }

  return (
    <div className="agent-harness" data-open={open ? '1' : '0'}>
      {!open && (
        <button
          type="button"
          className="agent-harness__fab"
          onClick={() => setOpen(true)}
          title={zh ? 'Agent 实验台' : 'Agent Harness (Book)'}
        >
          {zh ? 'Agent 实验台' : 'Agent Harness'}
        </button>
      )}

      {open && (
        <section
          className="agent-harness__panel"
          role="dialog"
          aria-label={zh ? 'Agent 实验台' : 'Agent Harness (Book)'}
        >
          <header className="agent-harness__head">
            <div>
              <p className="agent-harness__eyebrow">
                {zh ? '书对齐 Harness' : 'Book-aligned harness'}
              </p>
              <h2>{zh ? 'Agent 实验台' : 'Agent Harness (Book)'}</h2>
            </div>
            <button
              type="button"
              className="agent-harness__close"
              onClick={() => setOpen(false)}
              aria-label={zh ? '关闭' : 'Close'}
            >
              ×
            </button>
          </header>

          <form className="agent-harness__form" onSubmit={handleSubmit}>
            <label className="agent-harness__field">
              <span>{zh ? '消息' : 'Message'}</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder={zh ? '输入试跑消息…' : 'Try a message…'}
              />
            </label>

            <div className="agent-harness__row">
              <label className="agent-harness__field">
                <span>{zh ? '角色' : 'Character'}</span>
                <select
                  value={character}
                  onChange={(e) => setCharacter(e.target.value as CharacterId)}
                >
                  {CHARACTERS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="agent-harness__field">
                <span>{zh ? '模式' : 'Mode'}</span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as HarnessMode)}
                >
                  <option value="direct">direct</option>
                  <option value="crew">crew</option>
                </select>
              </label>

              <label className="agent-harness__field">
                <span>{zh ? '语言' : 'Language'}</span>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as Language)}
                >
                  <option value="zh">zh</option>
                  <option value="en">en</option>
                </select>
              </label>
            </div>

            <label className="agent-harness__check">
              <input
                type="checkbox"
                checked={offline}
                onChange={(e) => setOffline(e.target.checked)}
              />
              <span>
                {zh
                  ? 'offline（默认开，不打真实 LLM）'
                  : 'offline (default on - no live LLM)'}
              </span>
            </label>

            <div className="agent-harness__actions">
              <button type="submit" disabled={loading || !message.trim()}>
                {loading && activeAction === 'run'
                  ? zh
                    ? '运行中…'
                    : 'Running…'
                  : 'Run'}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void getJson('capabilities', '/api/agent/capabilities')}
              >
                Capabilities
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void getJson('lessons', '/api/agent/lessons')}
              >
                Lessons
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void getJson('trajectories', '/api/agent/trajectories')}
              >
                Trajectories
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void getJson('stats', '/api/agent/stats')}
              >
                Stats
              </button>
            </div>
          </form>

          {error && (
            <div className="agent-harness__error" role="alert">
              {error}
            </div>
          )}

          <div className="agent-harness__meta">
            <div>
              <h3>skills_used</h3>
              <pre>{formatField(skillsUsed)}</pre>
            </div>
            <div>
              <h3>status_bar</h3>
              <pre>{formatField(statusBar)}</pre>
            </div>
            <div>
              <h3>book_coverage</h3>
              <pre>{formatField(bookCoverage)}</pre>
            </div>
            <div>
              <h3>steps</h3>
              <pre>{summarizeSteps(steps)}</pre>
            </div>
          </div>

          {(reply || raw != null) && (
            <div className="agent-harness__result">
              {reply ? (
                <>
                  <h3>{zh ? '回复' : 'Reply'}</h3>
                  <pre className="agent-harness__reply">{reply}</pre>
                </>
              ) : null}
              <h3>JSON</h3>
              <pre className="agent-harness__json">{prettyJson(raw)}</pre>
            </div>
          )}

          <p className="agent-harness__hint">
            {zh
              ? '实验台：POST /api/agent/run。完整产品聊天仍走 director；可选 /api/chat useHarness=true 试 harness。'
              : 'Experiment surface: POST /api/agent/run. Product chat still uses director; optional /api/chat useHarness=true for harness.'}
          </p>
        </section>
      )}
    </div>
  )
}
