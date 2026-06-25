/* =================================================================
   ABQ Roleplay Lab — AuthSection (Supabase email/password auth)
   ================================================================= */

import { useState, type FormEvent } from 'react'
import { useAuth } from '../hooks/useAuth'

type Language = 'en' | 'zh'

type AuthSectionProps = {
  auth: ReturnType<typeof useAuth>
  language: Language
  syncStatus: string | null
}

export function AuthSection({ auth, language, syncStatus }: AuthSectionProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const zh = language === 'zh'

  if (auth.loading) {
    return (
      <section>
        <span className="field-label">{zh ? '账户' : 'Account'}</span>
        <p className="hint">{zh ? '加载中…' : 'Loading…'}</p>
      </section>
    )
  }

  if (auth.user) {
    return (
      <section>
        <span className="field-label">{zh ? '已登录' : 'Signed in'}</span>
        <div className="service-status">
          <strong>{auth.user.email}</strong>
          <button className="panel-toggle" type="button" onClick={auth.signOut}>
            {zh ? '退出' : 'Sign out'}
          </button>
        </div>
        {syncStatus === 'synced' && (
          <p className="hint" style={{ marginTop: 6 }}>
            {zh ? '☁️ 云同步已开启' : '☁️ Cloud sync active'}
          </p>
        )}
      </section>
    )
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    try {
      if (mode === 'signup') {
        await auth.signUp(email, password)
      } else {
        await auth.signIn(email, password)
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Auth failed')
    }
  }

  return (
    <section>
      <span className="field-label">{zh ? '账户' : 'Account'}</span>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 8 }}>
        <input
          type="email"
          placeholder={zh ? '邮箱' : 'Email'}
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder={zh ? '密码' : 'Password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={6}
        />
        <button type="submit" className="panel-toggle" style={{ width: '100%', padding: '10px' }}>
          {mode === 'signin' ? (zh ? '登录' : 'Sign in') : (zh ? '注册' : 'Sign up')}
        </button>
        {formError && <p style={{ color: 'var(--color-error-text)', fontSize: 12 }}>{formError}</p>}
        <button
          type="button"
          className="panel-toggle"
          onClick={() => { setMode(m => m === 'signin' ? 'signup' : 'signin'); setFormError(null) }}
        >
          {mode === 'signin'
            ? (zh ? '没有账号？注册' : "Don't have an account? Sign up")
            : (zh ? '已有账号？登录' : 'Have an account? Sign in')}
        </button>
      </form>
    </section>
  )
}
