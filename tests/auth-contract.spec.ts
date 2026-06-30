import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const migration = readFileSync(`${PROJECT_ROOT}supabase/migrations/20260626120000_create_tables.sql`, 'utf8')

describe('Supabase auth and RLS contract', () => {
  it('enables row-level security on user-owned profile tables', () => {
    assert.match(migration, /ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;/)
    assert.match(migration, /ALTER TABLE character_memory ENABLE ROW LEVEL SECURITY;/)
    assert.match(migration, /ALTER TABLE story_sessions ENABLE ROW LEVEL SECURITY;/)
  })

  it('restricts user-owned profile rows to auth.uid() = user_id', () => {
    assert.match(
      migration,
      /CREATE POLICY "Users manage own messages" ON chat_messages FOR ALL USING \(auth\.uid\(\) = user_id\);/,
    )
    assert.match(
      migration,
      /CREATE POLICY "Users manage own memory" ON character_memory FOR ALL USING \(auth\.uid\(\) = user_id\);/,
    )
    assert.match(
      migration,
      /CREATE POLICY "Users manage own stories" ON story_sessions FOR ALL USING \(auth\.uid\(\) = user_id\);/,
    )
  })
})
