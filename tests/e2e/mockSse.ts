import { expect, type Page } from '@playwright/test'

/**
 * Story uses fetch SSE (`openFetchSse`), not `EventSource`.
 * Keep the `__mockSSE.emit` / `__mockSSEInstances` contract the specs already use.
 */
export async function installMockEventSource(page: Page) {
  await page.addInitScript(() => {
    type MockHandle = {
      url: string
      readyState: number
      emit: (type: string, data: unknown) => void
      close: () => void
    }
    type MockWindow = Window & {
      __mockSSE: MockHandle | null
      __mockSSEInstances: MockHandle[]
    }
    const w = window as MockWindow
    const origFetch = window.fetch.bind(window)
    w.__mockSSE = null
    w.__mockSSEInstances = []

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      if (!url.includes('/stream')) {
        return origFetch(input, init)
      }

      let closed = false
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null
      const inst: MockHandle = {
        url,
        readyState: 0,
        emit(type, data) {
          const payload = typeof data === 'string' ? data : JSON.stringify(data)
          const hook = (window as Window & { __storyHandleEvent?: (t: string, raw: string) => void }).__storyHandleEvent
          if (hook) {
            hook(type, payload)
            return
          }
          if (closed || !controller) return
          controller.enqueue(new TextEncoder().encode(`event: ${type}\ndata: ${payload}\n\n`))
        },
        close() {
          if (closed) return
          closed = true
          inst.readyState = 2
          try {
            controller?.close()
          } catch {
            /* already closed */
          }
        },
      }
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
        },
        cancel() {
          inst.readyState = 2
          closed = true
        },
      })
      w.__mockSSE = inst
      w.__mockSSEInstances.push(inst)

      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      if (signal) {
        if (signal.aborted) inst.close()
        else signal.addEventListener('abort', () => inst.close(), { once: true })
      }

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
  })
}

/** Director extras live under a closed <details>; open it for BeatControls specs. */
export async function expectDirectorControls(page: Page) {
  const summary = page.locator('.beat-paused__advanced summary')
  if ((await summary.count()) > 0) {
    const visible = await page.locator('.beat-controls').isVisible().catch(() => false)
    if (!visible) await summary.click()
  }
  await expect(page.locator('.beat-controls')).toBeVisible()
}
