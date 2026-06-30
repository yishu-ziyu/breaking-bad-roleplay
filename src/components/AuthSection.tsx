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
  const syncCopy = (() => {
    if (syncStatus === 'syncing') {
      return zh ? '正在保存本机进度…' : 'Saving local progress...'
    }
    if (syncStatus === 'sync-failed') {
      return zh ? '同步失败，本机进度仍保留' : 'Sync failed. Local progress is still kept.'
    }
    if (syncStatus === 'privacy-locked') {
      return zh ? '私密档案已锁定，重新登录后继续云端同步' : 'Private profile locked. Sign in again to resume cloud sync.'
    }
    if (syncStatus === 'synced') {
      return zh ? '本机进度已合并到云端档案' : 'Local progress merged into your cloud profile.'
    }
    return null
  })()

  if (auth.loading) {
    return (
      <section>
        <span className="field-label">{zh ? '玩家档案' : 'Player Profile'}</span>
        <p className="hint">{zh ? '读取档案中…' : 'Loading profile…'}</p>
      </section>
    )
  }

  if (auth.error === 'not_configured') {
    return (
      <section>
        <span className="field-label">{zh ? '玩家档案' : 'Player Profile'}</span>
        <p className="hint" style={{ color: 'var(--color-error-text)' }}>
          {zh ? '档案同步未配置' : 'Profile sync not configured'}
        </p>
      </section>
    )
  }

  if (auth.user) {
    return (
      <section>
        <span className="field-label">{zh ? '已同步档案' : 'Profile Synced'}</span>
        <div className="service-status">
          <strong>{auth.user.email}</strong>
          <button className="panel-toggle" type="button" onClick={auth.signOut}>
            {zh ? '断开同步' : 'Disconnect'}
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
      <span className="field-label">{zh ? '玩家档案' : 'Player Profile'}</span>
      <p className="hint" style={{ marginBottom: 10 }}>
        {zh
          ? '同步后，你的会谈、角色记忆和本机进度会合并到档案。'
          : 'Sync to merge conversations, character memory, and local progress into your profile.'}
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
          placeholder={zh ? '访问密码' : 'Access password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={6}
        />
        <button type="submit" className="auth-btn-primary">
          {mode === 'signin' ? (zh ? '同步档案' : 'Sync Profile') : (zh ? '创建档案' : 'Create Profile')}
        </button>
        {formError && <p className="auth-error">{formError}</p>}
        <button
          type="button"
          className="auth-btn-secondary"
          onClick={() => { setMode(m => m === 'signin' ? 'signup' : 'signin'); setFormError(null) }}
        >
          {mode === 'signin'
            ? (zh ? '没有档案？创建一个' : "No profile yet? Create one")
            : (zh ? '已有档案？同步登录' : 'Already have a profile? Sync')}
        </button>
      </form>

      {!guestHint && (
        <button
          type="button"
          className="auth-btn-guest"
          onClick={() => setGuestHint(true)}
        >
          {zh ? '以访客身份进入' : 'Enter as Guest'}
        </button>
      )}

      {guestHint && (
        <p className="auth-guest-hint">
          {zh
            ? '访客进度会保存在本机。同步档案后，可在多设备继续。'
            : 'Guest progress stays on this device. Sync a profile to continue across devices.'}
        </p>
      )}
    </section>
  )
}
