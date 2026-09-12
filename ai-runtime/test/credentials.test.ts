import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { PerformanceRuntime } from "../src/runtime.ts"
import {
  hasUsableApodexKey,
  isApodexBaseUrl,
  liveProviderFromEnv,
  resolveRuntimeMode,
} from "../src/providers.ts"
import { beatRequest } from "./helpers.ts"

const CORE_11 = new Set(["apodex-1.1", "apodex-1.1-mini"])

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

  it("never logs the api key", async () => {
    const secret = "sk-apodex-fake-key-for-log-test"
    const lines: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => {
      lines.push(args.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" "))
    }
    const runtime = new PerformanceRuntime()
    try {
      await runtime.perform(
        beatRequest({
          request_id: "log-redact",
          provider: {
            provider_id: "openai-compatible",
            model_id: "apodex-1.1",
            api_key: secret,
            base_url: "https://api.apodex.ai/v1",
          },
        }),
        { fauxSteps: [{ type: "text", text: "I already said yes to Elliott." }] },
      )
    } finally {
      runtime.shutdown()
      console.log = original
    }
    const dumped = lines.join("\n")
    assert.equal(dumped.includes(secret), false)
    assert.match(dumped, /openai-compatible/)
    assert.match(dumped, /apodex-1\.1/)
  })

  it("runs live Apodex 1.1 only when APODEX_API_KEY is set", async (t) => {
    if (!hasUsableApodexKey()) {
      t.skip("No APODEX_API_KEY in env. Faux contract stays green.")
      return
    }
    const provider = liveProviderFromEnv()
    assert.ok(provider)
    assert.equal(provider.provider_id, "openai-compatible")
    assert.ok(CORE_11.has(provider.model_id ?? ""))
    assert.equal(/deep-research|solve|discover/i.test(provider.model_id ?? ""), false)
    assert.ok(isApodexBaseUrl(provider.base_url))
    if (!process.env.APODEX_MODEL) {
      assert.equal(provider.model_id, "apodex-1.1")
    }

    const runtime = new PerformanceRuntime()
    try {
      const result = await runtime.perform(
        beatRequest({ provider, request_id: "live-apodex-1.1" }),
        { timeoutMs: 25_000 },
      )
      assert.equal(result.character_id, "walter")
      assert.ok(result.reply_text.length > 0)
      assert.equal((result.stage_direction ?? "").includes(provider.api_key ?? "\u0000"), false)
    } finally {
      runtime.shutdown()
    }
  })
})
