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
  const [guestHint, setGuestHint] = useState(false)
  const zh = language === 'zh'

  if (auth.loading) {
    return (
      <section>
        <span className="field-label">{zh ? '账户' : 'Account'}</span>
        <p className="hint">{zh ? '加载中…' : 'Loading…'}</p>
      </section>
    )
  }

  if (auth.error === 'not_configured') {
    return (
      <section>
        <span className="field-label">{zh ? '账户' : 'Account'}</span>
        <p className="hint" style={{ color: 'var(--color-error-text)' }}>
          {zh ? 'Supabase 未配置' : 'Supabase not configured'}
        </p>
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
    <section className="auth-section">
      <span className="field-label">{zh ? '账户' : 'Account'}</span>
      <form onSubmit={handleSubmit} className="auth-form">
        <input
          type="email"
          className="auth-input"
          placeholder={zh ? '邮箱' : 'Email'}
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          className="auth-input"
          placeholder={zh ? '密码' : 'Password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={6}
        />
        <button type="submit" className="auth-btn-primary">
          {mode === 'signin' ? (zh ? '登录' : 'Sign in') : (zh ? '注册' : 'Sign up')}
        </button>
        {formError && <p className="auth-error">{formError}</p>}
        <button
          type="button"
          className="auth-btn-secondary"
          onClick={() => { setMode(m => m === 'signin' ? 'signup' : 'signin'); setFormError(null) }}
        >
          {mode === 'signin'
            ? (zh ? '没有账号？注册' : "Don't have an account? Sign up")
            : (zh ? '已有账号？登录' : 'Have an account? Sign in')}
        </button>
      </form>

      {!guestHint && (
        <button
          type="button"
          className="auth-btn-guest"
          onClick={() => setGuestHint(true)}
        >
          {zh ? '无需登录，先试试' : 'Try without login'}
        </button>
      )}

      {guestHint && (
        <p className="auth-guest-hint">
          {zh
            ? '你可以直接开始对话。登录后可在多设备同步。'
            : 'You can start chatting. Sign in later to save across devices.'}
        </p>
      )}
    </section>
  )
}
