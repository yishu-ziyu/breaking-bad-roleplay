#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const envFiles = ['.env.rls.local', '.env.local']

function parseEnvFile(path) {
  if (!existsSync(path)) return {}
  const values = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    values[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
  return values
}

const fileEnv = Object.assign({}, ...envFiles.map(parseEnvFile))
const env = { ...fileEnv, ...process.env }

function requireEnv(...keys) {
  for (const key of keys) {
    if (env[key]) return env[key]
  }
  throw new Error(`Missing required env: ${keys.join(' or ')}`)
}

const supabaseUrl = requireEnv('SUPABASE_URL', 'VITE_SUPABASE_URL')
const publishableKey = requireEnv('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY')
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

const runId = randomUUID()
const emailA = env.RLS_TEST_EMAIL_A || `rls-a-${runId}@example.com`
const emailB = env.RLS_TEST_EMAIL_B || `rls-b-${runId}@example.com`
const passwordA = env.RLS_TEST_PASSWORD_A || `Rls-${runId.slice(0, 18)}-A`
const passwordB = env.RLS_TEST_PASSWORD_B || `Rls-${runId.slice(0, 18)}-B`

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function userClient() {
  return createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function assertNoError(label, result) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`)
  }
  return result.data
}

function assertRows(label, rows, count) {
  if (!Array.isArray(rows) || rows.length !== count) {
    throw new Error(`${label}: expected ${count} row(s), got ${Array.isArray(rows) ? rows.length : 'non-array'}`)
  }
}

async function createVerifiedUser(email, password) {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`create test user ${email}: ${error.message}`)
  return data.user
}

async function signIn(email, password) {
  const client = userClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign in ${email}: ${error.message}`)
  if (!data.user) throw new Error(`sign in ${email}: no user returned`)
  return { client, user: data.user }
}

async function expectDenied(label, promise) {
  const { data, error } = await promise
  if (!error) {
    throw new Error(`${label}: expected RLS denial, but request succeeded with ${JSON.stringify(data)}`)
  }
  return error.message
}

async function verifyTableIsolation({ table, ownInsert, attackerInsert, ownSelectColumns = '*' }) {
  const ownRow = assertNoError(
    `${table} owner insert`,
    await userA.client.from(table).insert(ownInsert).select(ownSelectColumns).single(),
  )

  const ownerRows = assertNoError(
    `${table} owner read own row`,
    await userA.client.from(table).select(ownSelectColumns).eq('id', ownRow.id),
  )
  assertRows(`${table} owner read own row`, ownerRows, 1)

  const attackerRows = assertNoError(
    `${table} other user cannot read row`,
    await userB.client.from(table).select(ownSelectColumns).eq('id', ownRow.id),
  )
  assertRows(`${table} other user cannot read row`, attackerRows, 0)

  const anonymousRows = assertNoError(
    `${table} anonymous user cannot read row`,
    await userClient().from(table).select(ownSelectColumns).eq('id', ownRow.id),
  )
  assertRows(`${table} anonymous user cannot read row`, anonymousRows, 0)

  const denial = await expectDenied(
    `${table} other user cannot insert row as owner`,
    userB.client.from(table).insert(attackerInsert).select(ownSelectColumns).single(),
  )

  return { ownRow, denial }
}

let rawUserA
let rawUserB
let userA
let userB

const checks = []

try {
  console.log('RLS verification: creating two temporary confirmed users...')
  rawUserA = await createVerifiedUser(emailA, passwordA)
  rawUserB = await createVerifiedUser(emailB, passwordB)
  userA = await signIn(emailA, passwordA)
  userB = await signIn(emailB, passwordB)

  if (userA.user.id !== rawUserA.id || userB.user.id !== rawUserB.id) {
    throw new Error('Signed-in user ids do not match admin-created users')
  }
  checks.push('auth: temporary users can sign in with ordinary user sessions')

  const chat = await verifyTableIsolation({
    table: 'chat_messages',
    ownSelectColumns: 'id,user_id,character_id,message,sender,emotion',
    ownInsert: {
      user_id: rawUserA.id,
      character_id: 'walter',
      message: `RLS smoke chat ${runId}`,
      sender: 'user',
      emotion: null,
    },
    attackerInsert: {
      user_id: rawUserA.id,
      character_id: 'walter',
      message: `RLS malicious chat ${runId}`,
      sender: 'user',
      emotion: null,
    },
  })
  checks.push(`chat_messages: owner read/write allowed, other-user and anonymous access blocked (${chat.denial})`)

  const memory = await verifyTableIsolation({
    table: 'character_memory',
    ownSelectColumns: 'id,user_id,character_id,summary,key_facts',
    ownInsert: {
      user_id: rawUserA.id,
      character_id: 'walter',
      summary: `RLS smoke memory ${runId}`,
      key_facts: [{ runId, source: 'verify-supabase-rls' }],
    },
    attackerInsert: {
      user_id: rawUserA.id,
      character_id: 'jesse',
      summary: `RLS malicious memory ${runId}`,
      key_facts: [{ runId, source: 'verify-supabase-rls' }],
    },
  })
  checks.push(`character_memory: owner read/write allowed, other-user and anonymous access blocked (${memory.denial})`)

  const story = await verifyTableIsolation({
    table: 'story_sessions',
    ownSelectColumns: 'id,user_id,task_prompt,current_beat,confirmed',
    ownInsert: {
      user_id: rawUserA.id,
      task_prompt: `RLS smoke story ${runId}`,
      outline: '',
      beats: [],
      current_beat: 0,
      confirmed: false,
    },
    attackerInsert: {
      user_id: rawUserA.id,
      task_prompt: `RLS malicious story ${runId}`,
      outline: '',
      beats: [],
      current_beat: 0,
      confirmed: false,
    },
  })
  checks.push(`story_sessions: owner read/write allowed, other-user and anonymous access blocked (${story.denial})`)

  console.log('\nRLS verification passed:')
  for (const check of checks) console.log(`- ${check}`)
} finally {
  console.log('\nRLS verification: cleaning temporary data...')
  if (rawUserA?.id) {
    await service.from('chat_messages').delete().eq('user_id', rawUserA.id)
    await service.from('character_memory').delete().eq('user_id', rawUserA.id)
    await service.from('story_sessions').delete().eq('user_id', rawUserA.id)
    await service.auth.admin.deleteUser(rawUserA.id)
  }
  if (rawUserB?.id) {
    await service.from('chat_messages').delete().eq('user_id', rawUserB.id)
    await service.from('character_memory').delete().eq('user_id', rawUserB.id)
    await service.from('story_sessions').delete().eq('user_id', rawUserB.id)
    await service.auth.admin.deleteUser(rawUserB.id)
  }
}
