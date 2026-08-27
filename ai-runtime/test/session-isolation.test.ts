import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { credentialFingerprint } from "../src/sessions.ts"
import { PerformanceRuntime } from "../src/runtime.ts"
import { beatRequest } from "./helpers.ts"

const runtimes: PerformanceRuntime[] = []
afterEach(() => {
  for (const runtime of runtimes) runtime.shutdown()
  runtimes.length = 0
})

describe("session isolation", () => {
  it("keeps two games' Walter sessions, memory, and keys apart", async () => {
    const runtime = new PerformanceRuntime()
    runtimes.push(runtime)
    await runtime.perform(
      beatRequest({
        game_id: "game-A",
        request_id: "a1",
        character_memory: { secret: "alpha" },
        provider: { provider_id: "openai", model_id: "model-a", api_key: "sk-aaa" },
      }),
      { fauxSteps: [{ type: "text", text: "Game A only." }] },
    )
    await runtime.perform(
      beatRequest({
        game_id: "game-B",
        request_id: "b1",
        character_memory: { secret: "beta" },
        provider: { provider_id: "openai", model_id: "model-b", api_key: "sk-bbb" },
      }),
      { fauxSteps: [{ type: "text", text: "Game B only." }] },
    )
    const a = runtime.registry.get("game-A", "walter")
    const b = runtime.registry.get("game-B", "walter")
    assert.ok(a && b)
    assert.notEqual(a.session, b.session)
    assert.notEqual(a.memory, b.memory)
    assert.deepEqual(a.memory, { secret: "alpha" })
    assert.deepEqual(b.memory, { secret: "beta" })
    assert.notEqual(a.credentialFingerprint, b.credentialFingerprint)
    assert.notEqual(a.modelId, b.modelId)
    assert.match((a.session as { lastPrompt?: string }).lastPrompt ?? "", /game-A|lie_to_skyler/)
    runtime.dispose("game-A")
    assert.equal(runtime.registry.get("game-A", "walter"), undefined)
    assert.ok(runtime.registry.get("game-B", "walter"))
  })

  it("expires sessions on TTL sweep", async () => {
    const runtime = new PerformanceRuntime()
    runtimes.push(runtime)
    await runtime.perform(beatRequest({ game_id: "ttl" }), {
      fauxSteps: [{ type: "text", text: "ok" }],
    })
    const record = runtime.registry.get("ttl", "walter")
    assert.ok(record)
    record.lastUsedAt = Date.now() - 40 * 60 * 1000
    runtime.registry.sweep()
    assert.equal(runtime.registry.get("ttl", "walter"), undefined)
  })

  it("fingerprints credentials without storing the raw key on the prompt object", () => {
    const left = credentialFingerprint(beatRequest({
      provider: { api_key: "sk-left", model_id: "m", provider_id: "openai" },
    }))
    const right = credentialFingerprint(beatRequest({
      provider: { api_key: "sk-right", model_id: "m", provider_id: "openai" },
    }))
    assert.notEqual(left, right)
    assert.doesNotMatch(left, /sk-left/)
  })
})
