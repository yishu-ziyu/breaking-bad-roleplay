/** Fetch-based SSE client.

EventSource cannot set headers and auto-reconnects, which re-billed story
beats and put access tokens on the query string. This client sends headers,
never reconnects, and surfaces HTTP errors from the original response.
*/

export type SseController = {
  close: () => void
}

export function parseSseChunk(
  buffer: string,
): {
  events: Array<{ event: string; data: string }>
  rest: string
  /** Complete frames consumed (including comment-only heartbeat frames). */
  frames: number
} {
  const events: Array<{ event: string; data: string }> = []
  let rest = buffer
  let frames = 0
  while (true) {
    const splitAt = rest.indexOf('\n\n')
    if (splitAt < 0) break
    const raw = rest.slice(0, splitAt)
    frames += 1
    rest = rest.slice(splitAt + 2)
    let event = 'message'
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length > 0) {
      events.push({ event, data: dataLines.join('\n') })
    }
  }
  return { events, rest, frames }
}

export function openFetchSse(
  url: string,
  options: {
    headers?: Record<string, string>
    onEvent: (eventType: string, data: string) => void
    /** Any bytes arrived — including `: ping` heartbeat comment frames that
     * never surface through onEvent. Used to re-arm stall watchdogs: the
     * connection is alive even while the Director is mid-LLM-call. */
    onActivity?: () => void
    onHttpError?: (status: number, body: unknown) => void
    onNetworkError?: (err: unknown) => void
    onClose?: () => void
  },
): SseController {
  const ac = new AbortController()
  void (async () => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(options.headers ?? {}),
        },
        signal: ac.signal,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        options.onHttpError?.(res.status, body)
        return
      }
      if (!res.body) {
        options.onNetworkError?.(new Error('SSE response has no body'))
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && value.length > 0) options.onActivity?.()
        buffer += decoder.decode(value, { stream: true })
        const parsed = parseSseChunk(buffer)
        buffer = parsed.rest
        for (const evt of parsed.events) {
          options.onEvent(evt.event, evt.data)
        }
      }
      options.onClose?.()
    } catch (err) {
      if (ac.signal.aborted) return
      options.onNetworkError?.(err)
    }
  })()
  return {
    close: () => {
      ac.abort()
    },
  }
}
