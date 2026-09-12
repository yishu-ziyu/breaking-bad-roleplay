import type {
  PerformanceRequest,
  PerformanceResult,
  PublicStreamEvent,
} from "./contracts.ts"
import { ALLOWED_TOOLS, assertPerformanceResult, sessionKey } from "./contracts.ts"
import { defaultWalterLine, FauxSession, type FauxStep } from "./faux.ts"
import { createPiSession } from "./pi-session.ts"
import { piSessionOptions, resolveRuntimeMode } from "./providers.ts"
import { assertNoCodingPersona, systemPromptFor, userPromptFor } from "./prompts.ts"
import {
  CharacterSessionRegistry,
  credentialFingerprint,
  type AgentLike,
  type SessionRecord,
} from "./sessions.ts"
import { collectPublicStream, textFromPublicStream } from "./streaming.ts"
import { characterMemoryTool } from "./tools/get-character-memory.ts"
import { visibleGameStateTool } from "./tools/get-visible-game-state.ts"
import { searchMaterialsTool } from "./tools/search-materials.ts"

export type PerformHooks = {
  onEvent?: (event: PublicStreamEvent) => void
  signal?: AbortSignal
  fauxSteps?: FauxStep[]
  timeoutMs?: number
}

export class PerformanceRuntime {
  readonly registry = new CharacterSessionRegistry()
  readonly builtinToolsDisabled = true
  readonly allowedTools = [...ALLOWED_TOOLS]

  constructor() {
    this.registry.startSweeper()
  }

  sessionOptions(request: PerformanceRequest) {
    const prompt = systemPromptFor(request)
    assertNoCodingPersona(prompt)
    return {
      ...piSessionOptions(prompt),
      customTools: [
        visibleGameStateTool(request.resolved_beat),
        characterMemoryTool(request.character_memory),
        searchMaterialsTool(),
      ],
    }
  }

  async perform(request: PerformanceRequest, hooks: PerformHooks = {}): Promise<PerformanceResult> {
    const started = Date.now()
    const events: unknown[] = []
    try {
      const record = await this.ensureSession(request, hooks.fauxSteps)
      this.registry.touch(record)
      const unsubscribe = record.session.subscribe(event => {
        events.push(event)
        const publicEvents = collectPublicStream([event as { type?: string }])
        for (const pub of publicEvents) hooks.onEvent?.(pub)
      })
      const timeoutMs = hooks.timeoutMs ?? 20_000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        await record.session.prompt(userPromptFor(request), {
          signal: hooks.signal ?? controller.signal,
        })
      } finally {
        clearTimeout(timer)
        unsubscribe()
      }
      const publicEvents = collectPublicStream(events as Array<{ type?: string }>)
      if (!publicEvents.some(e => e.type === "done")) {
        hooks.onEvent?.({ type: "done" })
      }
      const text = textFromPublicStream(publicEvents).trim() || defaultWalterLine(request)
      const result = assertPerformanceResult({
        character_id: "walter",
        reply_text: text,
        emotion_state: "tense",
        source: resolveRuntimeMode(request) === "pi" && !hooks.fauxSteps ? "pi" : "faux",
      })
      this.log(request, started, "ok")
      return result
    } catch (error) {
      this.log(request, started, "fallback")
      hooks.onEvent?.({ type: "content", text: defaultWalterLine(request) })
      hooks.onEvent?.({ type: "done" })
      return {
        character_id: "walter",
        reply_text: defaultWalterLine(request),
        emotion_state: "tense",
        source: "fallback",
        stage_direction: error instanceof Error ? error.message : "runtime failure",
      }
    }
  }

  async abort(gameId: string, characterId = "walter"): Promise<void> {
    await this.registry.abort(gameId, characterId)
  }

  dispose(gameId: string, characterId?: string): void {
    this.registry.dispose(gameId, characterId)
  }

  shutdown(): void {
    this.registry.disposeAll()
  }

  private async ensureSession(request: PerformanceRequest, fauxSteps?: FauxStep[]): Promise<SessionRecord> {
    const key = sessionKey(request.game_id, request.character_id)
    const existing = this.registry.get(request.game_id, request.character_id)
    const fingerprint = credentialFingerprint(request)
    const modelId = request.provider?.model_id ?? "faux-walter"
    if (
      existing
      && existing.credentialFingerprint === fingerprint
      && existing.modelId === modelId
    ) {
      return existing
    }
    if (existing) this.registry.dispose(request.game_id, request.character_id)

    const prompt = systemPromptFor(request)
    assertNoCodingPersona(prompt)
    let session: AgentLike
    if (!fauxSteps && resolveRuntimeMode(request) === "pi") {
      session = await createPiSession(request)
    } else {
      session = new FauxSession(
        prompt,
        fauxSteps ?? [{ type: "text", text: defaultWalterLine(request) }],
      )
    }
    const record: SessionRecord = {
      key,
      gameId: request.game_id,
      characterId: request.character_id,
      credentialFingerprint: fingerprint,
      modelId,
      memory: request.character_memory ?? null,
      session,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    }
    this.registry.put(record)
    return record
  }

  private log(request: PerformanceRequest, started: number, finish: string): void {
    console.log(
      JSON.stringify({
        request_id: request.request_id,
        game_id: request.game_id,
        turn: request.turn,
        character_id: request.character_id,
        provider: request.provider?.provider_id ?? "faux",
        model: request.provider?.model_id ?? "faux",
        latency_ms: Date.now() - started,
        tool_names: this.allowedTools,
        retry_count: 0,
        finish_status: finish,
      }),
    )
  }
}

export const runtime = new PerformanceRuntime()
