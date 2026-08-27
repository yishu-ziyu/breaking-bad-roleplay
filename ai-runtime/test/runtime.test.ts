import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { FORBIDDEN_RESULT_KEYS, FORBIDDEN_TOOLS } from "../src/contracts.ts"
import { loadCharacterPrompt, systemPromptFor } from "../src/prompts.ts"
import { PerformanceRuntime } from "../src/runtime.ts"
import { beatRequest } from "./helpers.ts"

const runtimes: PerformanceRuntime[] = []

function freshRuntime(): PerformanceRuntime {
  const runtime = new PerformanceRuntime()
  runtimes.push(runtime)
  return runtime
}

afterEach(() => {
  for (const runtime of runtimes) runtime.shutdown()
  runtimes.length = 0
})

describe("Walter performance runtime", () => {
  it("starts, performs a ResolvedBeat, and disposes", async () => {
    const runtime = freshRuntime()
    const result = await runtime.perform(beatRequest(), {
      fauxSteps: [{ type: "text", text: "I already said yes to Elliott. That is all this is." }],
    })
    assert.equal(result.character_id, "walter")
    assert.match(result.reply_text, /Elliott/)
    assert.ok(!("game_state_delta" in result))
    const record = runtime.registry.get("game-a", "walter")
    assert.ok(record)
    runtime.dispose("game-a")
    assert.equal(runtime.registry.size(), 0)
  })

  it("covers the default coding persona completely", () => {
    const prompt = systemPromptFor(beatRequest())
    assert.match(prompt, /Walter White/)
    assert.doesNotMatch(prompt, /expert coding assistant/i)
    assert.doesNotMatch(prompt, /expert coding assistant/i)
    assert.match(loadCharacterPrompt("walter"), /not a coding agent/)
  })

  it("disables builtin coding tools and only allows read-only custom tools", () => {
    const runtime = freshRuntime()
    const options = runtime.sessionOptions(beatRequest())
    assert.equal(options.noTools, "builtin")
    assert.deepEqual(options.tools, runtime.allowedTools)
    for (const name of FORBIDDEN_TOOLS) {
      assert.ok(options.excludeTools.includes(name) || !options.tools.includes(name))
    }
    assert.ok(runtime.builtinToolsDisabled)
  })

  it("runs a faux tool-call then a final reply", async () => {
    const runtime = freshRuntime()
    const result = await runtime.perform(beatRequest(), {
      fauxSteps: [
        { type: "tool", name: "get_visible_game_state" },
        { type: "text", text: "The kitchen is quieter. The numbers are already paid." },
      ],
    })
    assert.match(result.reply_text, /kitchen/i)
  })

  it("rejects a write-tool in the faux loop", async () => {
    const runtime = freshRuntime()
    const result = await runtime.perform(beatRequest(), {
      fauxSteps: [{ type: "tool", name: "bash" }],
    })
    assert.equal(result.source, "fallback")
  })

  it("falls back on timeout without throwing", async () => {
    const runtime = freshRuntime()
    const result = await runtime.perform(beatRequest(), {
      fauxSteps: [{ type: "timeout" }],
    })
    assert.equal(result.source, "fallback")
    assert.ok(result.reply_text)
  })

  it("keeps PerformanceResult free of state deltas", async () => {
    const runtime = freshRuntime()
    const result = await runtime.perform(beatRequest(), {
      fauxSteps: [{ type: "text", text: "Stay in the kitchen." }],
    })
    for (const key of FORBIDDEN_RESULT_KEYS) {
      assert.equal((result as Record<string, unknown>)[key], undefined)
    }
  })
})
