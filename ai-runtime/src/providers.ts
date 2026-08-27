import type { PerformanceRequest } from "./contracts.ts"

export type RuntimeMode = "faux" | "pi"

export const APODEX_PROVIDER_ID = "openai-compatible"
export const APODEX_DEFAULT_BASE_URL = "https://api.apodex.ai/v1"
export const APODEX_DEFAULT_MODEL = "apodex-1.1"

export function usableKey(value: string | undefined): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (trimmed.length < 16) return false
  if (/^test-key$/i.test(trimmed)) return false
  return true
}

export function isApodexBaseUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === "api.apodex.ai" || host.endsWith(".apodex.ai")
  } catch {
    return value.toLowerCase().includes("apodex.ai")
  }
}

/** Core 1.1 only — never deep-research / solve / discover. */
export function resolveApodexModel(raw?: string): string {
  const id = (raw || "").trim()
  if (id === "apodex-1.1-mini") return id
  return APODEX_DEFAULT_MODEL
}

export function hasUsableApodexKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return usableKey(env.APODEX_API_KEY)
}

function apodexBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.APODEX_BASE_URL || APODEX_DEFAULT_BASE_URL).trim().replace(/\/+$/, "")
  return raw || APODEX_DEFAULT_BASE_URL
}

function apodexFromDedicatedEnv(env: NodeJS.ProcessEnv = process.env): PerformanceRequest["provider"] | undefined {
  if (!usableKey(env.APODEX_API_KEY)) return undefined
  return {
    provider_id: APODEX_PROVIDER_ID,
    model_id: resolveApodexModel(env.APODEX_MODEL || env.AI_RUNTIME_MODEL),
    api_key: env.APODEX_API_KEY,
    base_url: apodexBaseUrl(env),
  }
}

function apodexFromOpenAICompatEnv(env: NodeJS.ProcessEnv = process.env): PerformanceRequest["provider"] | undefined {
  if (!usableKey(env.OPENAI_API_KEY) || !isApodexBaseUrl(env.OPENAI_BASE_URL)) return undefined
  return {
    provider_id: APODEX_PROVIDER_ID,
    model_id: resolveApodexModel(env.APODEX_MODEL || env.AI_RUNTIME_MODEL),
    api_key: env.OPENAI_API_KEY,
    base_url: (env.OPENAI_BASE_URL || APODEX_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  }
}

export function resolveRuntimeMode(
  request?: PerformanceRequest,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeMode {
  if (env.AI_RUNTIME_PROVIDER === "faux") return "faux"
  if (usableKey(request?.provider?.api_key)) return "pi"
  if (
    usableKey(env.APODEX_API_KEY)
    || (usableKey(env.OPENAI_API_KEY) && isApodexBaseUrl(env.OPENAI_BASE_URL))
    || usableKey(env.OPENAI_API_KEY)
    || usableKey(env.ANTHROPIC_API_KEY)
    || usableKey(env.MINIMAX_API_KEY)
  ) {
    return "pi"
  }
  return "faux"
}

export function liveProviderFromEnv(env: NodeJS.ProcessEnv = process.env): PerformanceRequest["provider"] | undefined {
  const apodex = apodexFromDedicatedEnv(env) ?? apodexFromOpenAICompatEnv(env)
  if (apodex) return apodex
  if (usableKey(env.OPENAI_API_KEY) && !isApodexBaseUrl(env.OPENAI_BASE_URL)) {
    return {
      provider_id: "openai",
      model_id: env.AI_RUNTIME_MODEL || "gpt-4o-mini",
      api_key: env.OPENAI_API_KEY,
    }
  }
  if (usableKey(env.ANTHROPIC_API_KEY)) {
    return {
      provider_id: "anthropic",
      model_id: env.AI_RUNTIME_MODEL || "claude-sonnet-4-5",
      api_key: env.ANTHROPIC_API_KEY,
    }
  }
  if (usableKey(env.MINIMAX_API_KEY)) {
    return {
      provider_id: "openai",
      model_id: env.AI_RUNTIME_MODEL || "MiniMax-M3",
      api_key: env.MINIMAX_API_KEY,
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
