import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadChatMessages,
  loadCharacterMemory,
  persistChatMessage,
  persistChatMessages,
  persistCharacterMemory,
  persistPrivateCharacterMemory,
  persistPrivateChatMessage,
} from './supabasePersistence.ts'
import { derivePrivacyKey, isEncryptedEnvelope } from './privacyVault.ts'
import type { createClient } from './supabaseClient.ts'

type SupabaseClient = ReturnType<typeof createClient>

function asSupabaseClient(fake: unknown): SupabaseClient {
  return fake as SupabaseClient
}

describe('supabasePersistence auth contract', () => {
  it('loads chat messages scoped to the authenticated user and active character', async () => {
    const calls: Array<{ op: string; args: unknown[] }> = []
    const query = {
      select(...args: unknown[]) { calls.push({ op: 'select', args }); return this },
      eq(...args: unknown[]) { calls.push({ op: 'eq', args }); return this },
      async order(...args: unknown[]) {
        calls.push({ op: 'order', args })
        return {
          data: [
            {
              message: 'Stay out of my territory.',
              sender: 'walter',
              emotion: 'threatening',
              created_at: '2026-07-01T00:00:00.000Z',
            },
          ],
          error: null,
        }
      },
    }
    const supabase = asSupabaseClient({
      from(table: string) {
        assert.equal(table, 'chat_messages')
        return query
      },
    })

    const rows = await loadChatMessages('user-1', 'walter', { supabase })

    assert.deepEqual(
      calls.filter(call => call.op === 'eq').map(call => call.args),
      [
        ['user_id', 'user-1'],
        ['character_id', 'walter'],
      ],
    )
    assert.deepEqual(rows, [
      {
        id: 'supa-2026-07-01T00:00:00.000Z-walter',
        sender: 'walter',
        text: 'Stay out of my territory.',
        emotion: 'threatening',
        gifQuery: null,
        gifUrl: null,
      },
    ])
  })

  it('loads character memory scoped to the authenticated user and active character', async () => {
    const filters: unknown[][] = []
    const query = {
      select() { return this },
      eq(...args: unknown[]) { filters.push(args); return this },
      async single() {
        return {
          data: { summary: 'Walter remembers the player took a risk.', key_facts: [{ fact: 'risk' }] },
          error: null,
        }
      },
    }
    const supabase = asSupabaseClient({
      from(table: string) {
        assert.equal(table, 'character_memory')
        return query
      },
    })

    const memory = await loadCharacterMemory('user-1', 'walter', { supabase })

    assert.deepEqual(filters, [
      ['user_id', 'user-1'],
      ['character_id', 'walter'],
    ])
    assert.deepEqual(memory, {
      summary: 'Walter remembers the player took a risk.',
      keyFacts: [{ fact: 'risk' }],
    })
  })

  it('persists a single chat message with the authenticated user id', async () => {
    let inserted: unknown
    const supabase = asSupabaseClient({
      from(table: string) {
        assert.equal(table, 'chat_messages')
        return {
          async insert(payload: unknown) {
            inserted = payload
            return { error: null }
          },
        }
      },
    })

    await persistChatMessage('user-1', {
      character_id: 'walter',
      message: 'I did it for me.',
      sender: 'user',
      emotion: null,
    }, supabase)

    assert.deepEqual(inserted, {
      user_id: 'user-1',
      character_id: 'walter',
      message: 'I did it for me.',
      sender: 'user',
      emotion: null,
    })
  })

  it('persists batch chat messages with the authenticated user id', async () => {
    let inserted: unknown
    const supabase = asSupabaseClient({
      from(table: string) {
        assert.equal(table, 'chat_messages')
        return {
          async insert(payload: unknown) {
            inserted = payload
            return { error: null }
          },
        }
      },
    })

    await persistChatMessages('user-1', [
      { character_id: 'walter', message: 'First', sender: 'user', emotion: null },
      { character_id: 'walter', message: 'Second', sender: 'walter', emotion: 'cold' },
    ], supabase)

    assert.deepEqual(inserted, [
      { user_id: 'user-1', character_id: 'walter', message: 'First', sender: 'user', emotion: null },
      { user_id: 'user-1', character_id: 'walter', message: 'Second', sender: 'walter', emotion: 'cold' },
    ])
  })

  it('persists memory with the authenticated user id and an update timestamp', async () => {
    let upserted: Record<string, unknown> | undefined
    const supabase = asSupabaseClient({
      from(table: string) {
        assert.equal(table, 'character_memory')
        return {
          async upsert(payload: Record<string, unknown>) {
            upserted = payload
            return { error: null }
          },
        }
      },
    })

    await persistCharacterMemory('user-1', {
      character_id: 'walter',
      summary: 'The player challenged Walter.',
      key_facts: [{ fact: 'challenge' }],
    }, supabase)

    assert.equal(upserted?.user_id, 'user-1')
    assert.equal(upserted?.character_id, 'walter')
    assert.equal(upserted?.summary, 'The player challenged Walter.')
    assert.deepEqual(upserted?.key_facts, [{ fact: 'challenge' }])
    assert.equal(typeof upserted?.updated_at, 'string')
  })

  it('persists private chat messages as ciphertext and decrypts them on load', async () => {
    const privacyKey = await derivePrivacyKey('player@example.com', 'password-123')
    let inserted: Record<string, unknown> | undefined
    const insertClient = asSupabaseClient({
      from(table: string) {
        assert.equal(table, 'chat_messages')
        return {
          async insert(payload: Record<string, unknown>) {
            inserted = { ...payload, created_at: '2026-07-01T00:00:00.000Z' }
            return { error: null }
          },
        }
      },
    })

    await persistPrivateChatMessage('user-1', {
      character_id: 'walter',
      message: 'This should not be readable in Supabase.',
      sender: 'user',
      emotion: null,
    }, privacyKey, insertClient)

    assert.equal(inserted?.user_id, 'user-1')
    assert.notEqual(inserted?.message, 'This should not be readable in Supabase.')
    assert.ok(isEncryptedEnvelope(inserted?.message))

    const loadClient = asSupabaseClient({
      from(table: string) {
        assert.equal(table, 'chat_messages')
        return {
          select() { return this },
          eq() { return this },
          async order() {
            return { data: [inserted], error: null }
          },
        }
      },
    })

    const rows = await loadChatMessages('user-1', 'walter', { supabase: loadClient, privacyKey })
    assert.equal(rows[0].text, 'This should not be readable in Supabase.')
  })

  it('persists private memory summary and key facts as ciphertext and decrypts them on load', async () => {
    const privacyKey = await derivePrivacyKey('player@example.com', 'password-123')
    let upserted: Record<string, unknown> | undefined
    const upsertClient = asSupabaseClient({
      from(table: string) {
        assert.equal(table, 'character_memory')
        return {
          async upsert(payload: Record<string, unknown>) {
            upserted = payload
            return { error: null }
          },
        }
      },
    })

    await persistPrivateCharacterMemory('user-1', {
      character_id: 'walter',
      summary: 'The player hid the evidence.',
      key_facts: [{ fact: 'evidence hidden' }],
    }, privacyKey, upsertClient)

    assert.ok(isEncryptedEnvelope(upserted?.summary))
    assert.notEqual(upserted?.summary, 'The player hid the evidence.')
    assert.deepEqual(
      (upserted?.key_facts as Array<Record<string, unknown>>)?.map(item => item.__abq_encrypted),
      [true],
    )

    const loadClient = asSupabaseClient({
      from(table: string) {
        assert.equal(table, 'character_memory')
        return {
          select() { return this },
          eq() { return this },
          async single() {
            return { data: upserted, error: null }
          },
        }
      },
    })

    const memory = await loadCharacterMemory('user-1', 'walter', { supabase: loadClient, privacyKey })
    assert.deepEqual(memory, {
      summary: 'The player hid the evidence.',
      keyFacts: [{ fact: 'evidence hidden' }],
    })
  })

  it('surfaces persistence errors instead of silently claiming sync success', async () => {
    const supabase = asSupabaseClient({
      from() {
        return {
          async insert() {
            return { error: new Error('database rejected write') }
          },
        }
      },
    })

    await assert.rejects(
      () => persistChatMessage('user-1', {
        character_id: 'walter',
        message: 'No half measures.',
        sender: 'mike',
        emotion: 'firm',
      }, supabase),
      /database rejected write/,
    )
  })
})
