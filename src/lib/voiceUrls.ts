import type { CharacterId } from '../roleProfiles'

export function relationSlug(relation: string): string {
  return relation.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function buildUrls(characterId: CharacterId, relation?: string): string[] {
  const base = `/voice/${characterId}`
  if (relation) {
    return [`${base}-${relationSlug(relation)}.mp3`, `${base}.mp3`]
  }
  return [`${base}.mp3`]
}
