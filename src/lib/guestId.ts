/* Guest identity for free-tier quota (server-enforced). Not a secret. */

const STORAGE_KEY = 'abq_guest_id_v1'

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function getOrCreateGuestId(): string {
  if (typeof window === 'undefined') {
    return '00000000-0000-4000-8000-000000000000'
  }
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY)
    if (existing && isUuid(existing)) return existing.toLowerCase()
  } catch {
    /* ignore */
  }
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0
          const v = c === 'x' ? r : (r & 0x3) | 0x8
          return v.toString(16)
        })
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
  return id
}

export function guestHeaders(): Record<string, string> {
  return { 'X-Guest-Id': getOrCreateGuestId() }
}

/** @deprecated Prefer authHeaders() from lib/authHeaders when login tier matters. */
export function guestHeadersOnly(): Record<string, string> {
  return guestHeaders()
}
