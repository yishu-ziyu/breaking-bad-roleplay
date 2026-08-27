import type { PerformanceRequest } from "./contracts.ts"
import { piSessionOptions } from "./providers.ts"
import { systemPromptFor } from "./prompts.ts"
import type { AgentLike } from "./sessions.ts"
import { characterMemoryTool } from "./tools/get-character-memory.ts"
import { visibleGameStateTool } from "./tools/get-visible-game-state.ts"
import { searchMaterialsTool } from "./tools/search-materials.ts"

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
  const providerId = request.provider?.provider_id ?? "openai"
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

  const { session } = await coding.createAgentSession({
    sessionManager: coding.SessionManager.inMemory(),
    resourceLoader: loader,
    modelRuntime,
    noTools: "builtin",
    tools: options.tools,
    excludeTools: options.excludeTools,
    customTools,
    thinkingLevel: "off",
  })
  return session as AgentLike
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
