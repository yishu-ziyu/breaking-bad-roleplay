/* =================================================================
   ABQ Roleplay Lab — useAuth hook (Supabase Auth)
   ================================================================= */

import { useEffect, useRef, useState } from 'react'
import { createClient } from '../lib/supabaseClient'
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
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    error: null,
  })
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    if (!supabase) {
      setState(s => ({ ...s, loading: false }))
      return
    }
    clientRef.current = supabase

    // Initial session check
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null }; error: Error | null }) => {
      setState({ user: data.session?.user ?? null, session: data.session, loading: false, error: null })
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      setState({ user: session?.user ?? null, session, loading: false, error: null })
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const supabase = clientRef.current
    if (!supabase) throw new Error('Supabase not configured')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signUp = async (email: string, password: string) => {
    const supabase = clientRef.current
    if (!supabase) throw new Error('Supabase not configured')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
  }

  const signOut = async () => {
    const supabase = clientRef.current
    if (!supabase) return
    await supabase.auth.signOut()
  }

  return { ...state, signIn, signUp, signOut }
}
