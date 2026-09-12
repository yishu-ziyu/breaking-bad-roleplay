import type { PerformanceRequest } from "./contracts.ts"
import {
  APODEX_DEFAULT_BASE_URL,
  APODEX_DEFAULT_MODEL,
  APODEX_PROVIDER_ID,
  isApodexBaseUrl,
  piSessionOptions,
  resolveApodexModel,
} from "./providers.ts"
import { systemPromptFor } from "./prompts.ts"
import type { AgentLike } from "./sessions.ts"
import { characterMemoryTool } from "./tools/get-character-memory.ts"
import { visibleGameStateTool } from "./tools/get-visible-game-state.ts"
import { searchMaterialsTool } from "./tools/search-materials.ts"

function redact(message: string, secret?: string): string {
  if (!secret) return message
  return message.split(secret).join("[redacted]")
}

function usesApodex(request: PerformanceRequest): boolean {
  const provider = request.provider
  if (!provider) return false
  return provider.provider_id === APODEX_PROVIDER_ID || isApodexBaseUrl(provider.base_url)
}

/**
 * Create a real pi-agent session. Credentials stay in-memory.
 * Builtin coding tools are disabled. Failure here must not touch GameState.
 */
export async function createPiSession(request: PerformanceRequest): Promise<AgentLike> {
  const coding = await import("@earendil-works/pi-coding-agent")
  const ai = await import("@earendil-works/pi-ai")
  const prompt = systemPromptFor(request)
  const options = piSessionOptions(prompt)
  const credentials = new ai.InMemoryCredentialStore()
  const modelRuntime = await coding.ModelRuntime.create({
    credentials,
    allowModelNetwork: false,
  })
  const apiKey = request.provider?.api_key
  const providerId = usesApodex(request)
    ? APODEX_PROVIDER_ID
    : (request.provider?.provider_id ?? "openai")
  const modelId = usesApodex(request)
    ? resolveApodexModel(request.provider?.model_id)
    : (request.provider?.model_id)

  try {
    if (usesApodex(request)) {
      const baseUrl = (request.provider?.base_url || APODEX_DEFAULT_BASE_URL).replace(/\/+$/, "")
      // $APODEX_API_KEY is env interpolation, not a literal secret.
      // The real key is injected only via setRuntimeApiKey (in-memory).
      modelRuntime.registerProvider(APODEX_PROVIDER_ID, {
        name: "Apodex",
        baseUrl,
        api: "openai-completions",
        apiKey: "$APODEX_API_KEY",
        authHeader: true,
        models: ["apodex-1.1", "apodex-1.1-mini"].map(id => ({
          id,
          name: id,
          reasoning: false,
          input: ["text"] as ("text" | "image")[],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 262_144,
          maxTokens: 16_384,
        })),
      })
    }
    if (apiKey) {
      await modelRuntime.setRuntimeApiKey(providerId, apiKey)
    }

    const loader = new coding.DefaultResourceLoader({
      ...options.resourceLoaderOptions,
      cwd: process.cwd(),
    })
    await loader.reload()

    const customTools = [
      wrapTool(coding, visibleGameStateTool(request.resolved_beat)),
      wrapTool(coding, characterMemoryTool(request.character_memory)),
      wrapTool(coding, searchMaterialsTool()),
    ]

    const model = modelId ? modelRuntime.getModel(providerId, modelId) : undefined
    const { session } = await coding.createAgentSession({
      sessionManager: coding.SessionManager.inMemory(),
      resourceLoader: loader,
      modelRuntime,
      model,
      noTools: "builtin",
      tools: options.tools,
      excludeTools: options.excludeTools,
      customTools,
      thinkingLevel: "off",
    })
    return session as AgentLike
  } catch (error) {
    const message = error instanceof Error ? error.message : "pi session failed"
    throw new Error(redact(message, apiKey))
  }
}

function wrapTool(
  coding: { defineTool?: (spec: Record<string, unknown>) => unknown },
  spec: {
    name: string
    description: string
    parameters: Record<string, unknown>
    execute: (...args: never[]) => Promise<unknown>
  },
): unknown {
  if (typeof coding.defineTool !== "function") return spec
  return coding.defineTool({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    execute: spec.execute,
  })
}
