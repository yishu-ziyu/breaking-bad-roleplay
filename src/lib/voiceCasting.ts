import type { CharacterId } from '../roleProfiles'

/**
 * Characters with MiniMax cloned voices (user-approved quality, 2026-07-13).
 * Backend must keep the same voice_id map in agents/voice_casting.py.
 */
export const CLONE_VOICE_CHARACTER_IDS: ReadonlySet<CharacterId> = new Set([
  'walter',
  'gus',
  'mike',
])

export function hasClonedVoice(characterId: string): boolean {
  return CLONE_VOICE_CHARACTER_IDS.has(characterId as CharacterId)
}
