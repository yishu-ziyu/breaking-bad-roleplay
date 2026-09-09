// Approved user-supplied portraits, shared by the preview and in-game surfaces.
// Keep Walter's original portrait. Unknown/future cast retain the prior fallback.
const illustrated = new Set(['jesse', 'saul', 'skyler', 'mike', 'gus', 'hank', 'marie'])
export function characterPortrait(id: string): string {
  return illustrated.has(id) ? `/avatars/illustrated/${id}.png` : `/avatars/desert-noir/${id}.jpg`
}
