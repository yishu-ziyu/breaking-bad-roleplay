/* =================================================================
   ABQ Roleplay Lab — Supabase client helpers (Vite SPA)
   ================================================================= */

import { createBrowserClient } from '@supabase/ssr'

const viteEnv = (import.meta as ImportMeta & {
  env?: {
    VITE_SUPABASE_URL?: string
    VITE_SUPABASE_PUBLISHABLE_KEY?: string
  }
}).env ?? {}

const SUPABASE_URL = viteEnv.VITE_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  // Dev fallback — no-op client so UI doesn't crash before env is set
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY not set')
}

export function createClient(): ReturnType<typeof createBrowserClient> | null {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return null
  }
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
}
