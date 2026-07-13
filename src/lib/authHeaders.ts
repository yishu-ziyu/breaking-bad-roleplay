/* Attach guest id + optional Supabase access token for free-tier tiers. */

import { createClient } from './supabaseClient'
import { guestHeaders } from './guestId'

/** Cached access token for SSE query strings (EventSource cannot set headers). */
let cachedAccessToken: string | null = null

export function setCachedAccessToken(token: string | null) {
  cachedAccessToken = token && token.trim() ? token.trim() : null
}

export function getCachedAccessToken(): string | null {
  return cachedAccessToken
}

/** Sync cache from live Supabase session when available. */
export async function refreshCachedAccessToken(): Promise<string | null> {
  try {
    const supabase = createClient()
    if (!supabase) {
      setCachedAccessToken(null)
      return null
    }
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? null
    setCachedAccessToken(token)
    return token
  } catch {
    setCachedAccessToken(null)
    return null
  }
}

/** Headers for normal fetch APIs (quota, chat, tts, …). */
export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...guestHeaders() }
  const token = (await refreshCachedAccessToken()) || cachedAccessToken
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

/** Sync headers when token is already cached (avoids await in tight paths). */
export function authHeadersSync(): Record<string, string> {
  const headers: Record<string, string> = { ...guestHeaders() }
  if (cachedAccessToken) {
    headers.Authorization = `Bearer ${cachedAccessToken}`
  }
  return headers
}
