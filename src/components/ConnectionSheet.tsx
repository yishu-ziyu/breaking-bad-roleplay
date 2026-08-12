/* =================================================================
   Connection sheet — BYOK branding UI (platform + multi-preset keys)
   ================================================================= */

import { useEffect, useMemo, useState } from 'react'
import type { UseConnectionReturn } from '../hooks/useConnection'
import type { MiniMaxRegion, ProviderId } from '../lib/providerBrands'
import {
  baseUrlSlotFor,
  brandsForMode,
  getProviderBrand,
  groupBrands,
  llmSlotFor,
  ttsSlotFor,
} from '../lib/providerBrands'

type Lang = 'zh' | 'en'

const copy = {
  en: {
    title: 'Model engine',
    modePlatform: 'Platform demo',
    modeByok: 'My keys',
    fieldLlm: 'Chat API key',
    fieldTts: 'Speech API key',
    fieldBase: 'API base URL',
    fieldRegion: 'Region',
    regionCn: 'China',
    regionGlobal: 'Global',
    fieldModel: 'Model',
    test: 'Test connection',
    saveBind: 'Save & use',
    clear: 'Clear keys',
    getKey: 'Get API key',
    trust: 'Keys are encrypted on-device. The server never stores them on disk — only a short-lived RAM session.',
    close: 'Close',
    status: 'Status',
    placeholderKey: 'Paste key…',
    placeholderBase: 'https://api.example.com/v1',
    platformOnly: 'Platform demo only offers MiniMax and StepFun.',
    savedKey: 'Saved on this device',
    leaveBlank: 'Leave blank to keep using the saved key',
    needKey: 'Paste an API key first (or use a saved one).',
    bound: 'Connected for this session',
    bindFailed: 'Could not open a session. Check the key and try again.',
    testing: 'Testing…',
    saving: 'Saving…',
  },
  zh: {
    title: '模型引擎',
    modePlatform: '平台演示',
    modeByok: '我的密钥',
    fieldLlm: '对话密钥',
    fieldTts: '语音密钥',
    fieldBase: '接口地址',
    fieldRegion: '区域',
    regionCn: '国内站',
    regionGlobal: '国际站',
    fieldModel: '模型',
    test: '测试连接',
    saveBind: '保存并用于本会话',
    clear: '清除密钥',
    getKey: '获取密钥',
    trust: '密钥加密保存在本机；服务端不入库，仅内存会话临时使用。',
    close: '关闭',
    status: '状态',
    placeholderKey: '粘贴密钥…',
    placeholderBase: 'https://api.example.com/v1',
    platformOnly: '平台演示只提供 MiniMax 和 StepFun。',
    savedKey: '本机已保存',
    leaveBlank: '留空则继续使用已保存密钥',
    needKey: '请先粘贴密钥，或使用本机已保存的密钥。',
    bound: '已绑定本会话',
    bindFailed: '无法建立会话，请检查密钥后重试。',
    testing: '测试中…',
    saving: '保存中…',
  },
} as const

const statusLabel: Record<string, Record<Lang, string>> = {
  empty: { en: 'Not configured', zh: '未配置' },
  saved: { en: 'Saved', zh: '已保存' },
  valid: { en: 'Connected', zh: '已连接' },
  invalid: { en: 'Invalid key', zh: '密钥无效' },
  quota: { en: 'Quota exceeded', zh: '额度不足' },
  unreachable: { en: 'Unreachable', zh: '线路不可达' },
}

type Props = {
  conn: UseConnectionReturn
  language: Lang
}

export function ConnectionSheet({ conn, language }: Props) {
  const { sheetOpen, setSheetOpen } = conn
  /* Modal behavior: Esc closes; focus moves into the sheet on open and returns
     to the opener on close. Lives on the wrapper (not the form) because the
     form remounts whenever the provider/model selection changes. */
  useEffect(() => {
    if (!sheetOpen) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const focusTimer = window.setTimeout(() => {
      document.querySelector<HTMLElement>('.connection-sheet__close')?.focus()
    }, 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(focusTimer)
      previouslyFocused?.focus()
    }
  }, [sheetOpen, setSheetOpen])

  if (!sheetOpen) return null
  const formKey = [
    conn.view.providerId,
    conn.view.mode,
    conn.view.modelId,
    conn.view.region,
    conn.view.baseUrl,
    conn.connectionSessionId ?? 'none',
  ].join('|')
  return <ConnectionSheetForm key={formKey} conn={conn} language={language} />
}

function ConnectionSheetForm({ conn, language }: Props) {
  const t = copy[language]
  const {
    vault,
    view,
    busy,
    message,
    setMessage,
    setActive,
    testAndSave,
    ensureBound,
    clearProviderKeys,
    setSheetOpen,
  } = conn
  const [mode, setMode] = useState(view.mode)
  const [providerId, setProviderId] = useState<ProviderId>(
    mode === 'platform' && view.providerId !== 'minimax' && view.providerId !== 'stepfun'
      ? 'stepfun'
      : view.providerId,
  )
  const [llmKey, setLlmKey] = useState('')
  const [ttsKey, setTtsKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(view.baseUrl || '')
  const [region, setRegion] = useState<MiniMaxRegion>(view.region)
  const [modelId, setModelId] = useState(view.modelId)
  const [action, setAction] = useState<'idle' | 'test' | 'save'>('idle')

  const brands = useMemo(() => brandsForMode(mode), [mode])
  const groups = useMemo(() => groupBrands(brands), [brands])
  const brand = getProviderBrand(providerId)

  const hintLlm = vault?.meta[llmSlotFor(providerId)]?.hint
  const hintTts = ttsSlotFor(providerId) ? vault?.meta[ttsSlotFor(providerId)!]?.hint : undefined
  const hintBase = baseUrlSlotFor(providerId)
    ? vault?.meta[baseUrlSlotFor(providerId)!]?.hint
    : undefined
  const savedLlm = Boolean(vault?.slots[llmSlotFor(providerId)])
  const savedTts = Boolean(ttsSlotFor(providerId) && vault?.slots[ttsSlotFor(providerId)!])

  const onSelectProvider = async (id: ProviderId) => {
    setProviderId(id)
    const b = getProviderBrand(id)
    setModelId(b.defaultModel)
    setBaseUrl(b.defaultBaseUrl || '')
    setLlmKey('')
    setTtsKey('')
    await setActive({
      providerId: id,
      modelId: b.defaultModel,
      region: b.defaultRegion || undefined,
      baseUrl: b.defaultBaseUrl,
    })
  }

  const onModeChange = async (next: 'platform' | 'byok') => {
    setMode(next)
    if (next === 'platform') {
      const safeId: ProviderId =
        providerId === 'minimax' || providerId === 'stepfun' ? providerId : 'stepfun'
      const b = getProviderBrand(safeId)
      setProviderId(safeId)
      setModelId(b.defaultModel)
      await setActive({
        mode: 'platform',
        providerId: safeId,
        modelId: b.defaultModel,
      })
      // Drop any BYOK RAM session when switching to platform demo.
      await ensureBound()
    } else {
      await setActive({ mode: 'byok' })
    }
  }

  const resolveLlmKey = () => {
    const typed = llmKey.trim()
    if (typed) return typed
    return vault?.slots[llmSlotFor(providerId)] || ''
  }

  const resolveTtsKey = () => {
    const typed = ttsKey.trim()
    if (typed) return typed
    const slot = ttsSlotFor(providerId)
    return slot ? (vault?.slots[slot] || '') : ''
  }

  const onTest = async () => {
    if (mode !== 'byok') return
    const key = resolveLlmKey()
    if (!key) {
      setMessage(t.needKey)
      return
    }
    setAction('test')
    try {
      await setActive({
        mode: 'byok',
        providerId,
        modelId,
        region: providerId === 'minimax' ? region : undefined,
        baseUrl: brand.needsBaseUrl || baseUrl ? baseUrl : brand.defaultBaseUrl,
      })
      await testAndSave({
        providerId,
        purpose: 'llm',
        apiKey: key,
        baseUrl: baseUrl || brand.defaultBaseUrl,
        region: providerId === 'minimax' ? region : undefined,
        modelId,
      })
      if (ttsKey.trim() && providerId === 'minimax') {
        await testAndSave({
          providerId,
          purpose: 'tts',
          apiKey: ttsKey.trim(),
          region,
        })
      }
    } finally {
      setAction('idle')
    }
  }

  const onSaveBind = async () => {
    await setActive({
      mode,
      providerId,
      modelId,
      region: providerId === 'minimax' ? region : undefined,
      baseUrl: brand.needsBaseUrl || baseUrl ? baseUrl : brand.defaultBaseUrl,
    })
    if (mode !== 'byok') {
      setSheetOpen(false)
      return
    }

    const key = resolveLlmKey()
    if (!key) {
      setMessage(t.needKey)
      return
    }

    setAction('save')
    try {
      // Test only when user pasted a fresh key (avoid burning tokens on every bind).
      if (llmKey.trim()) {
        const llmResult = await testAndSave({
          providerId,
          purpose: 'llm',
          apiKey: llmKey.trim(),
          baseUrl: baseUrl || brand.defaultBaseUrl,
          region: providerId === 'minimax' ? region : undefined,
          modelId,
        })
        if (!llmResult.ok) return
      }
      if (ttsKey.trim() && providerId === 'minimax') {
        const ttsResult = await testAndSave({
          providerId,
          purpose: 'tts',
          apiKey: ttsKey.trim(),
          region,
        })
        if (!ttsResult.ok) return
      }

      const bound = await ensureBound({
        llmKey: key,
        ttsKey: resolveTtsKey() || undefined,
        baseUrl: baseUrl || brand.defaultBaseUrl,
        providerId,
        modelId,
        region: providerId === 'minimax' ? region : undefined,
        mode: 'byok',
        force: Boolean(llmKey.trim() || ttsKey.trim()),
      })
      if (!bound) {
        setMessage(t.bindFailed)
        return
      }
      setMessage(t.bound)
      setLlmKey('')
      setTtsKey('')
      setSheetOpen(false)
    } finally {
      setAction('idle')
    }
  }

  const primaryLabel = () => {
    if (busy || action !== 'idle') {
      if (action === 'test') return t.testing
      if (action === 'save') return t.saving
      return '…'
    }
    return mode === 'byok' ? t.saveBind : t.modePlatform
  }

  return (
    <div
      className="connection-sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) setSheetOpen(false)
      }}
    >
      <div className="connection-sheet">
        <header className="connection-sheet__head">
          <div>
            <p className="connection-sheet__eyebrow">{t.title}</p>
            <h2>{view.chipLabel}</h2>
          </div>
          <button type="button" className="connection-sheet__close" onClick={() => setSheetOpen(false)}>
            {t.close}
          </button>
        </header>

        <div className="connection-sheet__modes">
          <button
            type="button"
            className={mode === 'platform' ? 'is-active' : ''}
            onClick={() => onModeChange('platform')}
          >
            {t.modePlatform}
          </button>
          <button
            type="button"
            className={mode === 'byok' ? 'is-active' : ''}
            onClick={() => onModeChange('byok')}
          >
            {t.modeByok}
          </button>
        </div>

        <div className="connection-sheet__groups">
          {groups.map(g => (
            <div key={g.group} className="connection-sheet__group">
              {mode === 'byok' && (
                <p className="connection-sheet__group-label">{g.groupLabel}</p>
              )}
              <div className="connection-sheet__brands">
                {g.brands.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    className={`connection-brand${providerId === b.id ? ' is-active' : ''}${
                      vault?.slots[llmSlotFor(b.id)] ? ' has-key' : ''
                    }`}
                    onClick={() => onSelectProvider(b.id)}
                  >
                    <strong>{b.displayName}</strong>
                    <span>{b.productLine}</span>
                    {b.platformDemo && mode === 'platform' && view.platform[b.id as 'minimax' | 'stepfun'] && (
                      <em className="connection-brand__plat">demo</em>
                    )}
                    {mode === 'byok' && vault?.slots[llmSlotFor(b.id)] && (
                      <em className="connection-brand__saved">key</em>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="connection-sheet__status">
          <span>{t.status}</span>
          <strong data-status={view.status}>
            {statusLabel[view.status]?.[language] || view.status}
            {view.hint ? ` · ${view.hint}` : ''}
            {view.connectionSessionId && mode === 'byok' ? ` · ${t.bound}` : ''}
          </strong>
        </div>

        {mode === 'byok' && (
          <div className="connection-sheet__fields">
            <label>
              <span>{t.fieldModel}</span>
              <select value={modelId} onChange={e => setModelId(e.target.value)}>
                {brand.models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>

            {providerId === 'minimax' && (
              <label>
                <span>{t.fieldRegion}</span>
                <select value={region} onChange={e => setRegion(e.target.value as MiniMaxRegion)}>
                  <option value="cn">{t.regionCn}</option>
                  <option value="global">{t.regionGlobal}</option>
                </select>
              </label>
            )}

            {(brand.needsBaseUrl || providerId === 'custom') && (
              <label>
                <span>
                  {t.fieldBase}
                  {hintBase ? ` (${hintBase})` : ''}
                </span>
                <input
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t.placeholderBase}
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                />
              </label>
            )}

            {brand.needsLlmKey && (
              <label>
                <span>
                  {t.fieldLlm}
                  {hintLlm ? ` (${hintLlm})` : ''}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={savedLlm ? t.leaveBlank : (brand.keyHintLlm || t.placeholderKey)}
                  value={llmKey}
                  onChange={e => setLlmKey(e.target.value)}
                />
                {savedLlm && !llmKey && (
                  <small className="connection-sheet__saved-hint">
                    {t.savedKey}
                    {hintLlm ? ` ${hintLlm}` : ''}
                  </small>
                )}
              </label>
            )}

            {brand.needsTtsKey && (
              <label>
                <span>
                  {t.fieldTts}
                  {hintTts ? ` (${hintTts})` : ''}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={savedTts ? t.leaveBlank : (brand.keyHintTts || t.placeholderKey)}
                  value={ttsKey}
                  onChange={e => setTtsKey(e.target.value)}
                />
              </label>
            )}

            {brand.consoleUrl && (
              <a className="connection-sheet__docs" href={brand.consoleUrl} target="_blank" rel="noreferrer">
                {t.getKey} ↗
              </a>
            )}
          </div>
        )}

        {mode === 'platform' && (
          <p className="connection-sheet__platform-note">
            {language === 'zh'
              ? `${t.platformOnly} 适合路演；个人用量请切换「我的密钥」。`
              : `${t.platformOnly} Switch to My keys for personal usage.`}
          </p>
        )}

        <p className="connection-sheet__trust">{t.trust}</p>
        {message && <p className="connection-sheet__msg" role="status">{message}</p>}

        <footer className="connection-sheet__actions">
          {mode === 'byok' && (
            <>
              <button
                type="button"
                className="connection-sheet__ghost"
                disabled={busy || action !== 'idle'}
                onClick={() => clearProviderKeys(providerId)}
              >
                {t.clear}
              </button>
              <button
                type="button"
                className="connection-sheet__secondary"
                disabled={busy || action !== 'idle'}
                onClick={onTest}
              >
                {action === 'test' ? t.testing : t.test}
              </button>
            </>
          )}
          <button
            type="button"
            className="connection-sheet__primary"
            disabled={busy || action !== 'idle'}
            onClick={onSaveBind}
          >
            {primaryLabel()}
          </button>
        </footer>
      </div>
    </div>
  )
}

export function ConnectionChip({
  conn,
  language,
  compact = false,
}: {
  conn: UseConnectionReturn
  language: Lang
  compact?: boolean
}) {
  const { view, setSheetOpen } = conn
  const statusText = statusLabel[view.status]?.[language] || view.status
  return (
    <button
      type="button"
      className={`connection-chip connection-chip--${view.status}${compact ? ' connection-chip--compact' : ''}`}
      onClick={() => setSheetOpen(true)}
      title={view.hint || statusText}
    >
      <span className="connection-chip__dot" aria-hidden="true" />
      <span className="connection-chip__label">{view.chipLabel}</span>
      {!compact && <span className="connection-chip__status">{statusText}</span>}
      <span className="connection-chip__caret" aria-hidden="true">▾</span>
    </button>
  )
}
