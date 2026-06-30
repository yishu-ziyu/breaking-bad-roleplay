/* =================================================================
   ABQ Roleplay Lab — useAuth hook (Supabase Auth)
   ================================================================= */

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../lib/supabaseClient'
import { clearStoredPrivacyKey, deriveAndStorePrivacyKey } from '../lib/privacyVault'
import type { Session, User } from '@supabase/supabase-js'

type AuthState = {
  user: User | null
  session: Session | null
  loading: boolean
  error: string | null
}

type UseAuthReturn = AuthState & {
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export function useAuth(): UseAuthReturn {
  const supabase = useMemo(() => createClient(), [])
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: Boolean(supabase),
    error: null,
  })

  useEffect(() => {
    if (!supabase) {
      return
    }

    // Initial session check
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null }; error: Error | null }) => {
      setState({ user: data.session?.user ?? null, session: data.session, loading: false, error: null })
    }).catch(() => {
      setState(s => ({ ...s, loading: false, error: 'Session check failed' }))
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      setState({ user: session?.user ?? null, session, loading: false, error: null })
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  const signIn = async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase not configured')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    const privacyUser = data.user ?? data.session?.user
    if (privacyUser) {
      await deriveAndStorePrivacyKey({ id: privacyUser.id, email: privacyUser.email ?? email }, password)
    }
    if (data.session) {
      setState({ user: data.session.user, session: data.session, loading: false, error: null })
    }
  }

  const signUp = async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase not configured')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    const privacyUser = data.user ?? data.session?.user
    if (privacyUser) {
      await deriveAndStorePrivacyKey({ id: privacyUser.id, email: privacyUser.email ?? email }, password)
    }
    if (data.session) {
      setState({ user: data.session.user, session: data.session, loading: false, error: null })
    }
  }

  const signOut = async () => {
    if (!supabase) return
    if (state.user) {
      clearStoredPrivacyKey(state.user.id)
    }
    await supabase.auth.signOut()
  }

  return { ...state, signIn, signUp, signOut }
}
