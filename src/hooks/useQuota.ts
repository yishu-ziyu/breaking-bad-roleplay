/* Platform free-tier remaining credits (server source of truth). */

import { useCallback, useEffect, useState } from 'react'
import { authHeaders, getCachedAccessToken, refreshCachedAccessToken } from '../lib/authHeaders'
import { getOrCreateGuestId } from '../lib/guestId'

export type QuotaView = {
  remaining: number
  limit: number
  used: number
  globalRemaining: number
  byok: boolean
  /** guest | user | byok */
  tier: string
  day: string
  costs: {
    chatDirect: number
    chatCrew: number
    storyBeat: number
    tts: number
  }
  loading: boolean
  error: string | null
}

const defaultCosts = {
  chatDirect: 1,
  chatCrew: 2,
  storyBeat: 5,
  tts: 1,
}

export function useQuota(connectionSessionId: string | null, authUserId?: string | null) {
  const [view, setView] = useState<QuotaView>({
    remaining: 8,
    limit: 8,
    used: 0,
    globalRemaining: 5000,
    byok: false,
    tier: 'guest',
    day: '',
    costs: defaultCosts,
    loading: true,
    error: null,
  })

  const refresh = useCallback(async () => {
    await refreshCachedAccessToken()
    const guest = getOrCreateGuestId()
    const qs = new URLSearchParams({ guest_id: guest })
    if (connectionSessionId) qs.set('connection_session', connectionSessionId)
    try {
      const res = await fetch(`/api/quota?${qs.toString()}`, {
        headers: await authHeaders(),
      })
      if (!res.ok) throw new Error(`quota ${res.status}`)
      const data = await res.json()
      setView({
        remaining: Number(data.remaining ?? 0),
        limit: Number(data.limit ?? 8),
        used: Number(data.used ?? 0),
        globalRemaining: Number(data.globalRemaining ?? 0),
        byok: Boolean(data.byok),
        tier: String(data.tier ?? (data.byok ? 'byok' : 'guest')),
        day: String(data.day ?? ''),
        costs: { ...defaultCosts, ...(data.costs || {}) },
        loading: false,
        error: null,
      })
    } catch (e) {
      setView((prev) => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }))
    }
  }, [connectionSessionId])

  useEffect(() => {
    void refresh()
  }, [refresh, authUserId])

  // Touch token cache so SSE can pick it up without another round-trip.
  useEffect(() => {
    if (authUserId) void refreshCachedAccessToken()
    else if (!getCachedAccessToken()) {
      /* guest */
    } else {
      void refreshCachedAccessToken()
    }
  }, [authUserId])

  return { ...view, refresh }
}

export type QuotaErrorBody = {
  code?: string
  message?: string
  remaining?: number
}

export async function parseQuotaError(res: Response): Promise<QuotaErrorBody | null> {
  // 402/429: meter exhausted. 410 (P3): binding_expired — the server lost
  // the RAM session behind our saved BYOK bind id; the sheet re-opens so
  // ensureBound can re-bind from the local vault, and the platform wallet
  // is never touched in the meantime.
  if (res.status !== 402 && res.status !== 429 && res.status !== 410) return null
  try {
    const body = await res.json()
    const detail = body?.detail
    if (detail && typeof detail === 'object') return detail as QuotaErrorBody
    if (typeof detail === 'string') return { message: detail, code: 'quota_denied' }
  } catch {
    /* ignore */
  }
  return { code: 'quota_denied', message: 'Free demo unavailable' }
}
