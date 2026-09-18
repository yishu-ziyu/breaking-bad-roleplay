import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AUTHORING_STORAGE_KEY,
  canEnterStory,
  playModeBlocked,
  readAuthoringFlag,
  reclaimVisitorStorySurface,
  resolveAuthoringMode,
  storyCardClickOutcome,
  storyComingSoonCopy,
  type AuthoringStorage,
  type StorySurfaceStore,
} from './storyAvailability.ts'

/** In-memory storage so both switch states are testable without a browser. */
function memoryStorage(initial: Record<string, string> = {}): AuthoringStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

test('authoring switch key matches the repo-wide convention', () => {
  assert.equal(AUTHORING_STORAGE_KEY, 'yishu_authoring_mode')
})

test('readAuthoringFlag reads ?authoring=1 / ?authoring=0 from query and hash', () => {
  assert.equal(readAuthoringFlag('', ''), null)
  assert.equal(readAuthoringFlag('?authoring=1', ''), true)
  assert.equal(readAuthoringFlag('?authoring=0', ''), false)
  assert.equal(readAuthoringFlag('', '#authoring=1'), true)
  assert.equal(readAuthoringFlag('?surface=direct&authoring=1', ''), true)
  assert.equal(readAuthoringFlag('?authoring=0&x=1', ''), false)
  // Anything else is not a flag — no partial matches, no truthy strings.
  assert.equal(readAuthoringFlag('?authoring=2', ''), null)
  assert.equal(readAuthoringFlag('?authoring=', ''), null)
  assert.equal(readAuthoringFlag('?not-authoring=1', ''), null)
  assert.equal(readAuthoringFlag('#characters', ''), null)
})

test('resolveAuthoringMode: ?authoring=1 opens author mode and persists it', () => {
  const storage = memoryStorage()
  assert.equal(resolveAuthoringMode({ search: '?authoring=1', hash: '', storage }), true)
  assert.equal(storage.map.get(AUTHORING_STORAGE_KEY), '1')
})

test('resolveAuthoringMode: ?authoring=0 closes author mode and clears the key', () => {
  const storage = memoryStorage({ [AUTHORING_STORAGE_KEY]: '1' })
  assert.equal(resolveAuthoringMode({ search: '?authoring=0', hash: '', storage }), false)
  assert.equal(storage.map.has(AUTHORING_STORAGE_KEY), false)
})

test('resolveAuthoringMode: stored switch survives reloads, absent storage stays visitor', () => {
  assert.equal(resolveAuthoringMode({ search: '', hash: '', storage: memoryStorage({ [AUTHORING_STORAGE_KEY]: '1' }) }), true)
  assert.equal(resolveAuthoringMode({ search: '', hash: '', storage: memoryStorage() }), false)
  assert.equal(resolveAuthoringMode({ search: '', hash: '', storage: null }), false)
})

test('resolveAuthoringMode: explicit argument is the last fallback', () => {
  assert.equal(resolveAuthoringMode({ explicit: true, search: '', hash: '', storage: memoryStorage() }), true)
  assert.equal(resolveAuthoringMode({ explicit: true, search: '?authoring=0', hash: '', storage: memoryStorage() }), false)
  assert.equal(resolveAuthoringMode({ explicit: true, search: '', hash: '', storage: memoryStorage({ [AUTHORING_STORAGE_KEY]: '1' }) }), true)
})

test('resolveAuthoringMode survives a storage that throws (private mode)', () => {
  const hostile: AuthoringStorage = {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('SecurityError')
    },
    removeItem: () => {
      throw new Error('SecurityError')
    },
  }
  assert.equal(resolveAuthoringMode({ search: '?authoring=1', hash: '', storage: hostile }), true)
  assert.equal(resolveAuthoringMode({ search: '?authoring=0', hash: '', storage: hostile }), false)
  assert.equal(resolveAuthoringMode({ search: '', hash: '', storage: hostile }), false)
})

test('story closes for visitors and stays open for authors', () => {
  assert.equal(canEnterStory(false), false)
  assert.equal(canEnterStory(true), true)
})

test('STORY card click: blocked for visitors, start / ask-track for authors', () => {
  assert.equal(storyCardClickOutcome({ storyOpen: false, hasKnowledgeTrack: true }), 'blocked')
  assert.equal(storyCardClickOutcome({ storyOpen: false, hasKnowledgeTrack: false }), 'blocked')
  assert.equal(storyCardClickOutcome({ storyOpen: true, hasKnowledgeTrack: true }), 'start')
  assert.equal(storyCardClickOutcome({ storyOpen: true, hasKnowledgeTrack: false }), 'ask-track')
})

test('play mode bar: only 剧情 is refused while Story is closed', () => {
  assert.equal(playModeBlocked('story', false), true)
  assert.equal(playModeBlocked('direct', false), false)
  assert.equal(playModeBlocked('crew', false), false)
  assert.equal(playModeBlocked('story', true), false)
})

/* ------------------------------------------------------------------ */
/*  Visitor Story-surface reclaim (T10 follow-up)                      */
/* ------------------------------------------------------------------ */

/** Fake store in parsed (JSON) values — the same shape App passes in. */
function surfaceStore(initial: { surface?: unknown; enteredWorld?: unknown }) {
  const state: { surface?: unknown; enteredWorld?: unknown } = { ...initial }
  const store: StorySurfaceStore = {
    readSurface: () => state.surface,
    readEnteredWorld: () => state.enteredWorld,
    writeEnteredWorld: (value) => {
      state.enteredWorld = value
    },
  }
  return { state, store }
}

test('visitor: a stored Story surface (enteredWorld=true) is reclaimed', () => {
  const visitor = surfaceStore({ surface: 'story', enteredWorld: true })
  assert.equal(reclaimVisitorStorySurface({ storyOpen: false, store: visitor.store }), true)
  assert.equal(visitor.state.enteredWorld, false)
})

test('visitor: an absent surface (legacy visitor) also means the Story board', () => {
  for (const surface of [undefined, null]) {
    const visitor = surfaceStore({ surface, enteredWorld: true })
    assert.equal(reclaimVisitorStorySurface({ storyOpen: false, store: visitor.store }), true)
    assert.equal(visitor.state.enteredWorld, false)
  }
})

test('visitor: Direct / Crew surfaces are never touched', () => {
  for (const surface of ['direct', 'crew', 'v4-unknown']) {
    const visitor = surfaceStore({ surface, enteredWorld: true })
    assert.equal(reclaimVisitorStorySurface({ storyOpen: false, store: visitor.store }), false)
    assert.equal(visitor.state.enteredWorld, true, `${surface} must survive`)
  }
})

test('visitor: nothing to reclaim when the world was never entered', () => {
  const visitor = surfaceStore({ surface: 'story', enteredWorld: false })
  assert.equal(reclaimVisitorStorySurface({ storyOpen: false, store: visitor.store }), false)
  assert.equal(visitor.state.enteredWorld, false)
})

test('author: an open Story keeps the stored surface on reload', () => {
  const author = surfaceStore({ surface: 'story', enteredWorld: true })
  assert.equal(reclaimVisitorStorySurface({ storyOpen: true, store: author.store }), false)
  assert.equal(author.state.enteredWorld, true)
})

test('reclaim writes a boolean false, the shape usePersistedState reads back', () => {
  const visitor = surfaceStore({ surface: 'story', enteredWorld: true })
  reclaimVisitorStorySurface({ storyOpen: false, store: visitor.store })
  assert.strictEqual(visitor.state.enteredWorld, false)
})

test('coming-soon copy is plain language in both languages', () => {
  const zh = storyComingSoonCopy('zh')
  assert.equal(zh.badge, '开发中')
  assert.match(zh.notice, /剧情正在开发中/)
  assert.match(zh.notice, /暂时/)
  // No internal terms, no metaphors.
  assert.doesNotMatch(zh.notice, /authoring|flag|gate|开关|模式条|骨架|云|雾|桥|门/i)

  const en = storyComingSoonCopy('en')
  assert.equal(en.badge, 'In development')
  assert.match(en.notice, /still in development/i)
  assert.match(en.notice, /cannot be opened yet|can't be opened yet|not available yet/i)
  assert.doesNotMatch(en.notice, /authoring|flag|gate|skeleton|bridge|doorway/i)
})
