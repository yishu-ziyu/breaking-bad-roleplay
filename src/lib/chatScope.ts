/** Persisted thread identity, distinct from the canonical NPC id sent to /chat.
 * Existing text character_id columns accept these keys, preserving RLS and
 * encryption without an unsafe in-place rewrite of unclassified old records.
 */
export function chatThreadKey(mode: 'direct' | 'crew', characterId: string): string {
  return `chat-v2:${mode}:${characterId}`
}

/** Legacy records have no trustworthy mode tag. Keep them read-only. */
export function mergeLegacyChat<T extends { sender: string; text: string }>(local: T[], cloud: T[]): T[] {
  const seen = new Set<string>()
  return [...local, ...cloud].filter(row => {
    const key = JSON.stringify([row.sender, row.text])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
