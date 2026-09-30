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
  const syncCopy = (() => {
    if (syncStatus === 'syncing') {
      return zh ? '正在保存…' : 'Saving…'
    }
    if (syncStatus === 'sync-failed') {
      return zh ? '没能保存到云端，这台设备上的记录还在。' : 'Could not save to the cloud. Everything on this device is still here.'
    }
    if (syncStatus === 'privacy-locked') {
      return zh ? '这台设备还打不开你的私密记录，重新登录一次就能继续保存到云端。' : 'This device cannot open your private records yet. Sign in again to keep saving to the cloud.'
    }
    if (syncStatus === 'synced') {
      return zh ? '这台设备上的记录已保存到你的账号。' : 'Everything on this device is now saved to your account.'
    }
    return null
  })()

  if (auth.loading) {
    return (
      <section>
        <span className="field-label">{zh ? '登录' : 'Sign in'}</span>
        <p className="hint">{zh ? '加载中…' : 'Loading…'}</p>
      </section>
    )
  }

  if (auth.error === 'not_configured') {
    return (
      <section>
        <span className="field-label">{zh ? '登录' : 'Sign in'}</span>
        <p className="hint" style={{ color: 'var(--color-error-text)' }}>
          {zh ? '登录暂时不可用' : 'Sign-in is not available right now'}
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
            {zh ? '退出登录' : 'Sign out'}
          </button>
        </div>
        {syncCopy && (
          <p
            className="hint"
            style={{
              marginTop: 6,
              color: syncStatus === 'sync-failed' || syncStatus === 'privacy-locked' ? 'var(--color-error-text)' : undefined,
            }}
          >
            {syncCopy}
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
      <span className="field-label">{zh ? '登录' : 'Sign in'}</span>
      <p className="hint" style={{ marginBottom: 10 }}>
        {zh
          ? '不登录也能玩。登录后，换台设备也能接着聊。'
          : 'You can play without signing in. Sign in to pick up your chats on another device.'}
      </p>
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
            ? (zh ? '还没有账号？注册' : 'No account yet? Sign up')
            : (zh ? '已有账号？登录' : 'Already have an account? Sign in')}
        </button>
      </form>
    </section>
  )
}
