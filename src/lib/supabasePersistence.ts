/* =================================================================
   ABQ Roleplay Lab — Supabase persistence layer
   ================================================================= */

import { createClient } from './supabaseClient'

export async function loadChatMessages(userId: string, characterId: string) {
  const supabase = createClient()
  if (!supabase) return []
  const { data, error } = await supabase
    .from('chat_messages')
    .select('message, sender, emotion, created_at')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('created_at', { ascending: true })

  if (error || !data) return []
  return data.map((row: Record<string, unknown>) => ({
    id: `supa-${row.created_at}-${row.sender}`,
    sender: row.sender as string,
    text: row.message as string,
    emotion: (row.emotion as string | null) ?? undefined,
    gifQuery: null,
    gifUrl: null,
  }))
}

export async function loadCharacterMemory(userId: string, characterId: string) {
  const supabase = createClient()
  if (!supabase) return null
  const { data, error } = await supabase
    .from('character_memory')
    .select('summary, key_facts')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .single()

  if (error || !data) return null
  return {
    summary: (data.summary as string) || '',
    keyFacts: ((data.key_facts as Array<Record<string, unknown>>) || []),
  }
}

export async function persistChatMessage(userId: string, msg: { character_id: string; message: string; sender: string; emotion: string | null }) {
  const supabase = createClient()
  if (!supabase) return
  await supabase.from('chat_messages').insert({
    user_id: userId,
    ...msg,
  })
}

export async function persistCharacterMemory(userId: string, memory: { character_id: string; summary: string; key_facts: Array<Record<string, unknown>> }) {
  const supabase = createClient()
  if (!supabase) return
  await supabase.from('character_memory').upsert({
    user_id: userId,
    ...memory,
    updated_at: new Date().toISOString(),
  })
}
