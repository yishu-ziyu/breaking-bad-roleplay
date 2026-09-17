/* =================================================================
   ABQ Roleplay Lab — useCharacterMemory
   Sliding summary + five-category durable facts for Direct continuity.
   ================================================================= */

import { useCallback, useRef } from 'react'
import {
  extractDurableFacts,
  mergeDurableFacts,
  type DurableFact,
  type DurableFactCategory,
} from '../lib/directDurableMemory'

/** @deprecated Prefer DurableFactCategory; kept for cloud payload compatibility. */
export type KeyFactCategory = DurableFactCategory | 'person' | 'location' | 'relationship' | 'event'

export interface KeyFact {
  category: KeyFactCategory
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
const MAX_FACTS = 24

export function useCharacterMemory(): UseCharacterMemoryReturn {
  const turnCountsRef = useRef<Record<string, number>>({})

  const addTurn = useCallback((characterId: string, sender: string, text: string, existingMemory: CharacterMemory): CharacterMemory => {
    const currentCount = turnCountsRef.current[characterId] ?? 0
    const turnNumber = currentCount + 1
    turnCountsRef.current[characterId] = turnNumber

    const incoming = extractDurableFacts(sender, text) as DurableFact[]
    const keyFacts = mergeDurableFacts(
      existingMemory.keyFacts as DurableFact[],
      incoming,
      MAX_FACTS,
    ) as KeyFact[]

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
