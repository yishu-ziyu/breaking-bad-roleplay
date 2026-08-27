import type { PerformanceRequest, SessionKey } from "./contracts.ts"
import { sessionKey } from "./contracts.ts"

export type AgentLike = {
  prompt: (text: string, options?: { signal?: AbortSignal }) => Promise<void>
  subscribe: (listener: (event: unknown) => void) => () => void
  abort: () => Promise<void> | void
  dispose: () => void
  messages?: unknown[]
  systemPrompt?: string
}

export type SessionRecord = {
  key: SessionKey
  gameId: string
  characterId: string
  credentialFingerprint: string
  modelId: string
  memory: unknown
  session: AgentLike
  createdAt: number
  lastUsedAt: number
}

export function credentialFingerprint(request: PerformanceRequest): string {
  const key = request.provider?.api_key ?? ""
  const model = request.provider?.model_id ?? "faux"
  const provider = request.provider?.provider_id ?? "faux"
  return `${provider}:${model}:${key.slice(0, 4)}:${key.length}`
}

export class CharacterSessionRegistry {
  private readonly sessions = new Map<SessionKey, SessionRecord>()
  private readonly ttlMs: number
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(ttlMs = 30 * 60 * 1000) {
    this.ttlMs = ttlMs
  }

  startSweeper(everyMs = 60_000): void {
    if (this.timer) return
    this.timer = setInterval(() => this.sweep(), everyMs)
    this.timer.unref?.()
  }

  get(gameId: string, characterId: string): SessionRecord | undefined {
    return this.sessions.get(sessionKey(gameId, characterId))
  }

  put(record: SessionRecord): void {
    this.sessions.set(record.key, record)
  }

  touch(record: SessionRecord): void {
    record.lastUsedAt = Date.now()
  }

  async abort(gameId: string, characterId: string): Promise<void> {
    const record = this.get(gameId, characterId)
    if (!record) return
    await record.session.abort()
  }

  dispose(gameId: string, characterId?: string): void {
    if (characterId) {
      const key = sessionKey(gameId, characterId)
      const record = this.sessions.get(key)
      record?.session.dispose()
      this.sessions.delete(key)
      return
    }
    for (const [key, record] of this.sessions) {
      if (record.gameId === gameId) {
        record.session.dispose()
        this.sessions.delete(key)
      }
    }
  }

  disposeAll(): void {
    for (const record of this.sessions.values()) {
      record.session.dispose()
    }
    this.sessions.clear()
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  sweep(now = Date.now()): void {
    for (const [key, record] of this.sessions) {
      if (now - record.lastUsedAt >= this.ttlMs) {
        record.session.dispose()
        this.sessions.delete(key)
      }
    }
  }

  size(): number {
    return this.sessions.size
  }
}
