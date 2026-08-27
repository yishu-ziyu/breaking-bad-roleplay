import type { PerformanceRequest } from "./contracts.ts"

export type RuntimeMode = "faux" | "pi"

function usableKey(value: string | undefined): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (trimmed.length < 16) return false
  if (/^test-key$/i.test(trimmed)) return false
  return true
}

export function resolveRuntimeMode(request?: PerformanceRequest): RuntimeMode {
  if (process.env.AI_RUNTIME_PROVIDER === "faux") return "faux"
  if (usableKey(request?.provider?.api_key)) return "pi"
  if (
    usableKey(process.env.OPENAI_API_KEY)
    || usableKey(process.env.ANTHROPIC_API_KEY)
    || usableKey(process.env.MINIMAX_API_KEY)
  ) {
    return "pi"
  }
  return "faux"
}

export function liveProviderFromEnv(): PerformanceRequest["provider"] | undefined {
  if (usableKey(process.env.OPENAI_API_KEY)) {
    return {
      provider_id: "openai",
      model_id: process.env.AI_RUNTIME_MODEL || "gpt-4o-mini",
      api_key: process.env.OPENAI_API_KEY,
    }
  }
  if (usableKey(process.env.ANTHROPIC_API_KEY)) {
    return {
      provider_id: "anthropic",
      model_id: process.env.AI_RUNTIME_MODEL || "claude-sonnet-4-5",
      api_key: process.env.ANTHROPIC_API_KEY,
    }
  }
  if (usableKey(process.env.MINIMAX_API_KEY)) {
    return {
      provider_id: "openai",
      model_id: process.env.AI_RUNTIME_MODEL || "MiniMax-M3",
      api_key: process.env.MINIMAX_API_KEY,
      base_url: "https://api.minimaxi.com/v1",
    }
  }
  return undefined
}

/** Session options we always pass into pi-agent. Tests assert this shape. */
export function piSessionOptions(systemPrompt: string) {
  return {
    noTools: "builtin" as const,
    tools: [
      "get_visible_game_state",
      "get_character_memory",
      "search_materials",
    ],
    excludeTools: ["bash", "powershell", "edit", "write", "read", "grep", "find", "ls"],
    thinkingLevel: "off" as const,
    resourceLoaderOptions: {
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [] as string[],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    },
    persistCredentials: false,
  }
}
