import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { collectPublicStream, toPublicEvent } from "../src/streaming.ts"
import { PerformanceRuntime } from "../src/runtime.ts"
import { FauxSession } from "../src/faux.ts"
import { beatRequest } from "./helpers.ts"

const runtimes: PerformanceRuntime[] = []
afterEach(() => {
  for (const runtime of runtimes) runtime.shutdown()
  runtimes.length = 0
})

describe("public stream", () => {
  it("keeps text order, drops thinking, and emits done once", () => {
    const events = collectPublicStream([
      { type: "thinking_delta", assistantMessageEvent: { type: "thinking_delta", delta: "hidden" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "The " } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "night." } },
      { type: "agent_settled" },
      { type: "agent_settled" },
    ])
    assert.deepEqual(events, [
      { type: "content", text: "The " },
      { type: "content", text: "night." },
      { type: "done" },
    ])
    assert.equal(toPublicEvent({ type: "thinking_delta" }), null)
  })

  it("aborts the current prompt and unsubscribes", async () => {
    const session = new FauxSession("Walter", [{ type: "text", text: "too late" }])
    const seen: unknown[] = []
    const unsub = session.subscribe(event => seen.push(event))
    await session.abort()
    await session.prompt("hi")
    assert.ok(session.aborted)
    unsub()
    session.dispose()
    assert.ok(session.disposed)
  })

  it("does not put thinking into the perform stream", async () => {
    const runtime = new PerformanceRuntime()
    runtimes.push(runtime)
    const publicEvents: Array<{ type: string; text?: string }> = []
    await runtime.perform(beatRequest(), {
      fauxSteps: [{ type: "text", text: "Visible line." }],
      onEvent: event => publicEvents.push(event),
    })
    assert.ok(publicEvents.some(e => e.type === "content" && e.text?.includes("Visible")))
    assert.ok(publicEvents.filter(e => e.type === "done").length === 1)
    assert.ok(!publicEvents.some(e => JSON.stringify(e).includes("thinking")))
  })
})
