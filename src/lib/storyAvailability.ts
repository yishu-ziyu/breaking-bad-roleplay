/**
 * Story availability switch (T10, product decision 2026-09-18).
 *
 * Story is closed to visitors until the product owner reopens it: the STORY
 * card and the 剧情 button in the play-mode bar show "剧情正在开发中" instead of
 * entering the board. Authors keep the full Story board for development.
 *
 * Two explicit runtime inputs — never a build-time flag (`import.meta.env.DEV`
 * would make local dev and the deployed build behave differently):
 *
 *   1. `?authoring=1` / `?authoring=0` in the URL (query or hash)
 *   2. localStorage `yishu_authoring_mode` = '1'
 *
 * This is the same convention as the archive desktop
 * (`components/mac-desktop/desktopRuntime.mjs` → `resolveAuthoringMode` /
 * `AUTHORING_STORAGE_KEY`); that file does not exist in this repo, so the
 * convention is reimplemented here.
 *
 * Everything is pure + injectable (`search` / `hash` / `storage`) so both the
 * visitor and the author state are unit-testable without a browser.
 */

export type StoryGateLanguage = 'zh' | 'en'

/** Author switch key, identical across repos (no `abq_` prefix on purpose). */
export const AUTHORING_STORAGE_KEY = 'yishu_authoring_mode'

export type AuthoringStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export type AuthoringInputs = {
  /** Last fallback when neither the URL nor storage says anything. */
  explicit?: boolean
  /** URL search, e.g. `?authoring=1`. Defaults to `window.location.search`. */
  search?: string
  /** URL hash, e.g. `#authoring=1`. Defaults to `window.location.hash`. */
  hash?: string
  /** Injectable storage; `null` means "no storage at all". Defaults to localStorage. */
  storage?: AuthoringStorage | null
}

function readWindowLocation(): { search: string; hash: string } {
  if (typeof window === 'undefined') return { search: '', hash: '' }
  try {
    return {
      search: String(window.location.search || ''),
      hash: String(window.location.hash || ''),
    }
  } catch {
    return { search: '', hash: '' }
  }
}

/** Real browser storage, or null when unavailable (node, private mode, blocked). */
export function defaultAuthoringStorage(): AuthoringStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function authoringParam(segment: string): string | null {
  if (!segment) return null
  const raw = segment.startsWith('?') || segment.startsWith('#') ? segment.slice(1) : segment
  if (!raw) return null
  try {
    return new URLSearchParams(raw).get('authoring')
  } catch {
    return null
  }
}

/**
 * `?authoring=1` → true, `?authoring=0` → false, absent / other values → null.
 * Query is checked before hash; no partial matches (`?not-authoring=1`).
 */
export function readAuthoringFlag(search: string, hash = ''): boolean | null {
  for (const segment of [search, hash]) {
    const value = authoringParam(segment)
    if (value === '1') return true
    if (value === '0') return false
  }
  return null
}

/**
 * Resolve the author switch: URL flag (and persist it) > stored key > explicit.
 * A URL flag always wins and is remembered, so `?authoring=1` keeps working
 * after a reload without the parameter.
 */
export function resolveAuthoringMode(inputs: AuthoringInputs = {}): boolean {
  const explicit = inputs.explicit ?? false
  const storage = inputs.storage === undefined ? defaultAuthoringStorage() : inputs.storage
  const location = readWindowLocation()
  const flag = readAuthoringFlag(
    inputs.search ?? location.search,
    inputs.hash ?? location.hash,
  )

  if (flag === true) {
    try {
      storage?.setItem(AUTHORING_STORAGE_KEY, '1')
    } catch {
      /* storage blocked — author mode still applies for this load */
    }
    return true
  }
  if (flag === false) {
    try {
      storage?.removeItem(AUTHORING_STORAGE_KEY)
    } catch {
      /* storage blocked — visitor mode still applies for this load */
    }
    return false
  }
  try {
    if (storage?.getItem(AUTHORING_STORAGE_KEY) === '1') return true
  } catch {
    /* storage blocked — fall through to the explicit argument */
  }
  return explicit
}

/**
 * The single open/closed decision for Story. Today it mirrors the author
 * switch; a future reopen (or a staged rollout) only changes this function.
 */
export function canEnterStory(authoring: boolean): boolean {
  return authoring
}

/* ------------------------------------------------------------------ */
/*  Visitor Story-surface reclaim (T10 follow-up)                      */
/* ------------------------------------------------------------------ */

/**
 * Storage access for the reclaim, in parsed (JSON) values. App wires this to
 * its own `readLs` / `writeLs` (`abq_` prefix + JSON), so a boolean `false`
 * lands exactly where `usePersistedState('enteredWorld')` reads it back.
 */
export type StorySurfaceStore = {
  /** Parsed `abq_surface`. `undefined` / `null` means "never chosen". */
  readSurface: () => unknown
  /** Parsed `abq_enteredWorld`. Only literal `true` counts. */
  readEnteredWorld: () => unknown
  writeEnteredWorld: (value: boolean) => void
}

/**
 * Gate + copy only close the *click* entry points, so a visitor who played
 * before Story closed still has the board stored (`abq_enteredWorld=true` with
 * the Story surface) and a reload went straight back into Story. This runs once
 * per load, before React hydrates `enteredWorld`, so the first paint is already
 * the cold-open door — never a story frame that jumps away.
 *
 * Rules:
 *   - authors (`storyOpen` true) keep their board untouched;
 *   - only a stored Story surface is reclaimed — a missing key means the app's
 *     own default, which is Story; Direct/Crew visitors stay where they were;
 *   - nothing is deleted: `abq_story_session_id` survives, so a developer who
 *     flips `?authoring=1` can still resume the same run.
 *
 * Returns true when `enteredWorld` was written back to false.
 */
export function reclaimVisitorStorySurface(input: {
  storyOpen: boolean
  store: StorySurfaceStore
}): boolean {
  if (input.storyOpen) return false
  if (input.store.readEnteredWorld() !== true) return false
  const surface = input.store.readSurface()
  // Absent key → the app default is 'story' (usePersistedState default).
  const onStorySurface = surface === undefined || surface === null || surface === 'story'
  if (!onStorySurface) return false
  input.store.writeEnteredWorld(false)
  return true
}

export type StoryCardOutcome = 'blocked' | 'start' | 'ask-track'

/** What a STORY-card click means right now. Closed Story wins over a saved track. */
export function storyCardClickOutcome(input: {
  storyOpen: boolean
  hasKnowledgeTrack: boolean
}): StoryCardOutcome {
  if (!input.storyOpen) return 'blocked'
  return input.hasKnowledgeTrack ? 'start' : 'ask-track'
}

/** True when a play-mode click must be refused instead of switching surface. */
export function playModeBlocked(mode: 'story' | 'direct' | 'crew', storyOpen: boolean): boolean {
  return mode === 'story' && !storyOpen
}

export type StoryComingSoonCopy = {
  /** Visible marker on the card / mode button: not open yet. */
  badge: string
  /** Message shown when a visitor tries to open Story. */
  notice: string
}

const STORY_COMING_SOON: Record<StoryGateLanguage, StoryComingSoonCopy> = {
  zh: {
    badge: '开发中',
    notice: '剧情正在开发中，暂时无法进入。你可以先体验单聊或群聊。',
  },
  en: {
    badge: 'In development',
    notice: 'Story mode is still in development and cannot be opened yet. Direct chat and Crew work right now.',
  },
}

export function storyComingSoonCopy(language: StoryGateLanguage): StoryComingSoonCopy {
  return STORY_COMING_SOON[language]
}
