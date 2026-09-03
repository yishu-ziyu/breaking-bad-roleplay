import type { PublicStreamEvent } from "./contracts.ts"

type UnknownEvent = {
  type?: string
  assistantMessageEvent?: { type?: string; delta?: string }
  thinking?: unknown
  name?: string
}

export function toPublicEvent(event: UnknownEvent): PublicStreamEvent | null {
  if (!event || typeof event !== "object") return null
  if (event.type === "thinking_delta" || event.assistantMessageEvent?.type === "thinking_delta") {
    return null
  }
  if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
    const text = event.assistantMessageEvent.delta ?? ""
    return text ? { type: "content", text } : null
  }
  if (event.type === "tool_execution_start") {
    return { type: "status", text: `tool:${event.name ?? "custom"}` }
  }
  if (event.type === "agent_settled") {
    return { type: "done" }
  }
  return null
}

export function collectPublicStream(events: UnknownEvent[]): PublicStreamEvent[] {
  const out: PublicStreamEvent[] = []
  let done = false
  for (const event of events) {
    const mapped = toPublicEvent(event)
    if (!mapped) continue
    if (mapped.type === "done") {
      if (done) continue
      done = true
    }
    out.push(mapped)
  }
  return out
}

export function textFromPublicStream(events: PublicStreamEvent[]): string {
  return events.filter(e => e.type === "content").map(e => e.text).join("")
}
