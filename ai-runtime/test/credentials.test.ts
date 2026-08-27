import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { liveProviderFromEnv, resolveRuntimeMode } from "../src/providers.ts"
import { PerformanceRuntime } from "../src/runtime.ts"
import { beatRequest } from "./helpers.ts"

describe("credentials / live provider", () => {
  it("stays on faux when no keys are present in this process", () => {
    const previous = process.env.AI_RUNTIME_PROVIDER
    process.env.AI_RUNTIME_PROVIDER = "faux"
    try {
      assert.equal(resolveRuntimeMode(beatRequest()), "faux")
    } finally {
      if (previous === undefined) delete process.env.AI_RUNTIME_PROVIDER
      else process.env.AI_RUNTIME_PROVIDER = previous
    }
  })

  it("documents skip when no live key exists", async (t) => {
    const provider = liveProviderFromEnv()
    if (!provider?.api_key) {
      t.skip("No OPENAI_API_KEY / ANTHROPIC_API_KEY / MINIMAX_API_KEY in env. Faux contract stays green.")
      return
    }
    const runtime = new PerformanceRuntime()
    try {
      const result = await runtime.perform(
        beatRequest({ provider, request_id: "live-1" }),
        { timeoutMs: 25_000 },
      )
      assert.equal(result.character_id, "walter")
      assert.ok(result.reply_text.length > 0)
    } finally {
      runtime.shutdown()
    }
  })
})
