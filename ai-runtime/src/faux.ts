import type { AgentLike } from "./sessions.ts"
import type { PerformanceRequest } from "./contracts.ts"
import { ALLOWED_TOOLS } from "./contracts.ts"
import { getVisibleGameState } from "./tools/get-visible-game-state.ts"
import { getCharacterMemory } from "./tools/get-character-memory.ts"
import { searchMaterials } from "./tools/search-materials.ts"

export type FauxStep =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; args?: Record<string, string> }
  | { type: "error"; message: string }
  | { type: "timeout" }

export class FauxSession implements AgentLike {
  messages: Array<{ role: string; content: string }> = []
  systemPrompt: string
  tools = [...ALLOWED_TOOLS]
  disposed = false
  aborted = false
  lastPrompt = ""
  private readonly steps: FauxStep[]
  private readonly listeners = new Set<(event: unknown) => void>()

  constructor(systemPrompt: string, steps: FauxStep[]) {
    this.systemPrompt = systemPrompt
    this.steps = steps
  }

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async prompt(text: string, options?: { signal?: AbortSignal }): Promise<void> {
    if (this.disposed) throw new Error("session disposed")
    this.lastPrompt = text
    this.messages.push({ role: "user", content: text })
    const emit = (event: unknown) => {
      for (const listener of this.listeners) listener(event)
    }
    try {
      for (const step of this.steps) {
        if (this.aborted || options?.signal?.aborted) {
          emit({ type: "agent_settled" })
          return
        }
        if (step.type === "timeout") {
          throw new Error("faux timeout")
        }
        if (step.type === "error") {
          throw new Error(step.message)
        }
        if (step.type === "tool") {
          if (!(ALLOWED_TOOLS as readonly string[]).includes(step.name)) {
            throw new Error(`forbidden tool: ${step.name}`)
          }
          emit({ type: "tool_execution_start", name: step.name })
          const result = runReadOnlyTool(step.name, step.args ?? {}, text)
          emit({ type: "tool_result", name: step.name, result })
          continue
        }
        for (const chunk of step.text.match(/.{1,12}/g) ?? [step.text]) {
          emit({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: chunk },
          })
        }
        this.messages.push({ role: "assistant", content: step.text })
      }
    } finally {
      emit({ type: "agent_settled" })
    }
  }

  async abort(): Promise<void> {
    this.aborted = true
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }
}

function runReadOnlyTool(name: string, args: Record<string, string>, prompt: string): string {
  const beat = extractBeat(prompt)
  if (name === "get_visible_game_state") return getVisibleGameState(beat)
  if (name === "get_character_memory") return getCharacterMemory(beat)
  if (name === "search_materials") return searchMaterials(args.query ?? "walter")
  throw new Error(`unknown tool ${name}`)
}

function extractBeat(prompt: string): { visible_state?: Record<string, unknown> } {
  const match = prompt.match(/ResolvedBeat[\s\S]*?(\{[\s\S]*\})/)
  if (!match) return {}
  try {
    return JSON.parse(match[1]) as { visible_state?: Record<string, unknown> }
  } catch {
    return {}
  }
}

export function defaultWalterLine(request: PerformanceRequest): string {
  const action = String(request.resolved_beat.player_action?.id ?? "wait")
  if (request.language === "zh") {
    return "这一夜还没结束。数字已经定了，我只负责把话说完。"
  }
  return `The night is not finished. ${action.replaceAll("_", " ")} is already settled. I will not pretend otherwise.`
}
