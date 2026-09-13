/** Whether the guest meter should block 说/做/观察 / chat. */

export type QuotaGate = {
  open?: boolean
  byok: boolean
  remaining: number
}

export function quotaBlocksPlay(q: QuotaGate): boolean {
  if (q.open || q.byok) return false
  return q.remaining <= 0
}
