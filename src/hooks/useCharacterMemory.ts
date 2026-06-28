/* =================================================================
   ABQ Roleplay Lab — useCharacterMemory (sliding window + summary)
   Last 8 turns: full context (sent to LLM via history)
   Older turns: compressed into summary
   Key facts: extracted per turn, structured
   ================================================================= */

import { useCallback, useRef } from 'react'

export interface KeyFact {
  category: 'person' | 'location' | 'secret' | 'relationship' | 'event'
  fact: string
}

export interface CharacterMemory {
  summary: string
  keyFacts: KeyFact[]
}

export interface UseCharacterMemoryReturn {
  addTurn: (characterId: string, sender: string, text: string, existingMemory: CharacterMemory) => CharacterMemory
  reset: (characterId?: string) => CharacterMemory
  getTurnCount: (characterId?: string) => number
}

const WINDOW_SIZE = 8
const SUMMARY_MAX_LENGTH = 500
const MAX_FACTS = 30

const FACT_PATTERNS: Array<{ pattern: RegExp; category: KeyFact['category'] }> = [
  { pattern: /\b(Walter|Jesse|Skyler|Saul|Mike|Gus|Hank|Marie|Gretchen|Elliott)\b/gi, category: 'person' },
  { pattern: /\b(ABQ|Albuquerque|New Mexico|Mexico|Cartel|DEA|lab|RV|cook|meth)\b/gi, category: 'location' },
  { pattern: /\b(secret|hidden|nobody knows|don't tell|between us|confidential)\b/gi, category: 'secret' },
  { pattern: /\b(partner|spouse|enemy|alliance|betray|trust|family|colleague)\b/gi, category: 'relationship' },
  { pattern: /\b(happened|occurred|discovered|escaped|killed|arrested|deal)\b/gi, category: 'event' },
]

export function useCharacterMemory(): UseCharacterMemoryReturn {
  const turnCountsRef = useRef<Record<string, number>>({})

  const addTurn = useCallback((characterId: string, sender: string, text: string, existingMemory: CharacterMemory): CharacterMemory => {
    const currentCount = turnCountsRef.current[characterId] ?? 0
    const turnNumber = currentCount + 1
    turnCountsRef.current[characterId] = turnNumber

    // Extract key facts from this turn
    const newFacts: KeyFact[] = []
    const seen = new Set<string>()
    for (const { pattern, category } of FACT_PATTERNS) {
      pattern.lastIndex = 0
      const matches = text.match(pattern)
      if (matches) {
        for (const match of matches) {
          const normalized = match.toLowerCase()
          if (!seen.has(normalized)) {
            seen.add(normalized)
            newFacts.push({ category, fact: match })
          }
        }
      }
    }

    // Merge key facts (deduplicate, cap)
    const mergedFacts = [...existingMemory.keyFacts]
    for (const fact of newFacts) {
      const exists = mergedFacts.some(f => f.fact.toLowerCase() === fact.fact.toLowerCase())
      if (!exists) {
        mergedFacts.push(fact)
      }
    }
    const keyFacts = mergedFacts.slice(-MAX_FACTS)

    // If beyond window, accumulate overflow into summary
    let summary = existingMemory.summary
    if (turnNumber > WINDOW_SIZE) {
      const fragment = `${sender}: ${text}`.slice(0, 200)
      const combined = summary ? `${summary} ${fragment}` : fragment
      summary = combined.length > SUMMARY_MAX_LENGTH
        ? combined.slice(-SUMMARY_MAX_LENGTH)
        : combined
    }

    return { summary, keyFacts }
  }, [])

  const reset = useCallback((characterId?: string): CharacterMemory => {
    if (characterId) {
      delete turnCountsRef.current[characterId]
    } else {
      turnCountsRef.current = {}
    }
    return { summary: '', keyFacts: [] }
  }, [])

  const getTurnCount = useCallback((characterId?: string) => {
    if (characterId) return turnCountsRef.current[characterId] ?? 0
    return 0
  }, [])

  return { addTurn, reset, getTurnCount }
}
