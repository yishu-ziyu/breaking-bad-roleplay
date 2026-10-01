/**
 * Group chat replies appear one at a time: the lead at once, then whoever cuts
 * in shows "typing…" for a beat before their line lands. Short pauses only —
 * a slow reveal reads as lag, not realism (docs/research round 2).
 */

export function crewRevealDelay(text: string): number {
  return Math.min(1800, 600 + Math.round((text || '').length * 15))
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    const id = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(id); resolve() }, { once: true })
  })

export async function revealCrewReplies<T extends { text: string }>(
  replies: T[],
  opts: {
    append: (reply: T) => void
    setTyping: (sender: string | null) => void
    senderOf: (reply: T) => string
    signal?: AbortSignal
    wait?: (ms: number) => Promise<void>
  },
): Promise<void> {
  const [lead, ...rest] = replies
  if (!lead) return
  opts.append(lead)
  if (rest.length === 0) return
  const wait = opts.wait ?? ((ms: number) => sleep(ms, opts.signal))
  for (const reply of rest) {
    // Already billed and received: an abort skips the pause, never the line.
    if (!opts.signal?.aborted) {
      opts.setTyping(opts.senderOf(reply))
      await wait(crewRevealDelay(reply.text))
    }
    opts.setTyping(null)
    opts.append(reply)
  }
}
