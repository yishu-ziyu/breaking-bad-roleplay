import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { PerformanceRequest } from "./contracts.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

const CODING_LEAKS = [
  "expert coding assistant",
  "you are a coding agent",
  "pi coding assistant",
  "you are pi",
]

export function loadCharacterPrompt(characterId: string): string {
  const path = join(ROOT, "resources", "characters", `${characterId}.md`)
  return readFileSync(path, "utf8")
}

export function systemPromptFor(request: PerformanceRequest): string {
  const base = loadCharacterPrompt(request.character_id)
  return [
    base,
    "",
    "## Performance contract",
    "You perform an already-resolved beat. The Game Kernel has already decided every number.",
    "You may choose how Walter speaks, pauses, and shows subtext.",
    "You may not decide success, meter changes, debt triggers, who leaves, or the next rule event.",
    "Never output game_state_delta, score_delta, objective_delta, debt_delta, or world_truth_delta.",
    "Never give real-world crime, chemistry, violence, laundering, weapons, or evasion instructions.",
    "Fictional tension only.",
    request.language === "zh" ? "Speak Simplified Chinese." : "Speak English.",
  ].join("\n")
}

export function userPromptFor(request: PerformanceRequest): string {
  return [
    `request_id=${request.request_id}`,
    `game_id=${request.game_id}`,
    `turn=${request.turn}`,
    "ResolvedBeat (already committed; read-only):",
    JSON.stringify(request.resolved_beat, null, 2),
    request.character_memory
      ? `Character memory (advisory):\n${JSON.stringify(request.character_memory)}`
      : "",
    "Perform Walter's reply for this beat. 2-6 sentences. No meter numbers unless a character would say them.",
  ]
    .filter(Boolean)
    .join("\n\n")
}

export function assertNoCodingPersona(prompt: string): void {
  const lower = prompt.toLowerCase()
  for (const leak of CODING_LEAKS) {
    if (lower.includes(leak)) {
      throw new Error(`coding persona leak: ${leak}`)
    }
  }
}

export function resourceLoaderOptions(prompt: string) {
  return {
    systemPromptOverride: () => prompt,
    appendSystemPromptOverride: () => [] as string[],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  }
}
