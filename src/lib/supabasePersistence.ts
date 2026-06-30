/* =================================================================
   ABQ Roleplay Lab — Supabase persistence layer
   ================================================================= */

import { createClient } from './supabaseClient'
import {
  decryptMaybeString,
  encryptedFactsEnvelope,
  encryptString,
  getEncryptedFactsPayload,
} from './privacyVault'

type SupabaseClient = ReturnType<typeof createClient>

type PersistenceOptions = {
  supabase?: SupabaseClient
  privacyKey?: CryptoKey | null
}

export async function loadChatMessages(userId: string, characterId: string, options: PersistenceOptions = {}) {
  const supabase = options.supabase ?? createClient()
  if (!supabase) return []
  const { data, error } = await supabase
    .from('chat_messages')
    .select('message, sender, emotion, created_at')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('created_at', { ascending: true })

  if (error || !data) return []
  return Promise.all(data.map(async (row: Record<string, unknown>) => ({
    id: `supa-${row.created_at}-${row.sender}`,
    sender: row.sender as string,
    text: await decryptMaybeString(row.message as string, options.privacyKey),
    emotion: (row.emotion as string | null) ?? undefined,
    gifQuery: null,
    gifUrl: null,
  })))
}

export async function loadCharacterMemory(userId: string, characterId: string, options: PersistenceOptions = {}) {
  const supabase = options.supabase ?? createClient()
  if (!supabase) return null
  const { data, error } = await supabase
    .from('character_memory')
    .select('summary, key_facts')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .single()

  if (error || !data) return null
  const encryptedFacts = getEncryptedFactsPayload(data.key_facts)
  const keyFacts = encryptedFacts
    ? JSON.parse(await decryptMaybeString(encryptedFacts, options.privacyKey)) as Array<Record<string, unknown>>
    : ((data.key_facts as Array<Record<string, unknown>>) || [])

  return {
    summary: await decryptMaybeString((data.summary as string) || '', options.privacyKey),
    keyFacts,
  }
}

type PersistedChatMessage = {
  character_id: string
  message: string
  sender: string
  emotion: string | null
}

export async function persistChatMessage(userId: string, msg: PersistedChatMessage, supabase: SupabaseClient = createClient()) {
  if (!supabase) return
  const { error } = await supabase.from('chat_messages').insert({
    user_id: userId,
    ...msg,
  })
  if (error) throw error
}

export async function persistPrivateChatMessage(userId: string, msg: PersistedChatMessage, privacyKey: CryptoKey, supabase: SupabaseClient = createClient()) {
  return persistChatMessage(userId, {
    ...msg,
    message: await encryptString(msg.message, privacyKey),
  }, supabase)
}

export async function persistChatMessages(userId: string, messages: PersistedChatMessage[], supabase: SupabaseClient = createClient()) {
  if (!supabase || messages.length === 0) return
  const { error } = await supabase.from('chat_messages').insert(
    messages.map(msg => ({
      user_id: userId,
      ...msg,
    })),
  )
  if (error) throw error
}

export async function persistPrivateChatMessages(userId: string, messages: PersistedChatMessage[], privacyKey: CryptoKey, supabase: SupabaseClient = createClient()) {
  if (messages.length === 0) return
  const encrypted = await Promise.all(messages.map(async msg => ({
    ...msg,
    message: await encryptString(msg.message, privacyKey),
  })))
  return persistChatMessages(userId, encrypted, supabase)
}

export async function persistCharacterMemory(
  userId: string,
  memory: { character_id: string; summary: string; key_facts: Array<Record<string, unknown>> },
  supabase: SupabaseClient = createClient(),
) {
  if (!supabase) return
  const { error } = await supabase.from('character_memory').upsert({
    user_id: userId,
    ...memory,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

export async function persistPrivateCharacterMemory(
  userId: string,
  memory: { character_id: string; summary: string; key_facts: Array<Record<string, unknown>> },
  privacyKey: CryptoKey,
  supabase: SupabaseClient = createClient(),
) {
  return persistCharacterMemory(userId, {
    ...memory,
    summary: await encryptString(memory.summary, privacyKey),
    key_facts: encryptedFactsEnvelope(await encryptString(JSON.stringify(memory.key_facts), privacyKey)),
  }, supabase)
}
