/* =================================================================
   Connection sheet — BYOK branding UI
   ================================================================= */

import { useState } from 'react'
import type { UseConnectionReturn } from '../hooks/useConnection'
import type { MiniMaxRegion, ProviderId } from '../lib/providerBrands'
import { getProviderBrand, llmSlotFor, ttsSlotFor } from '../lib/providerBrands'

type Lang = 'zh' | 'en'

const copy = {
  en: {
    title: 'Model line',
    modePlatform: 'Platform demo',
    modeByok: 'My keys',
    fieldLlm: 'Chat API key',
    fieldTts: 'Speech API key',
    fieldBase: 'Local base URL',
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
  },
  zh: {
    title: '模型线路',
    modePlatform: '平台演示',
    modeByok: '我的密钥',
    fieldLlm: '对话密钥',
    fieldTts: '语音密钥',
    fieldBase: '本地地址',
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
  // Remount form when the sheet opens so vault → form is initial state, not an effect sync.
  if (!conn.sheetOpen) return null
  const formKey = [
    conn.view.providerId,
    conn.view.mode,
    conn.view.modelId,
    conn.view.region,
    conn.connectionSessionId ?? 'none',
  ].join('|')
  return <ConnectionSheetForm key={formKey} conn={conn} language={language} />
}

function ConnectionSheetForm({ conn, language }: Props) {
  const t = copy[language]
  const { vault, view, brands, busy, message, setActive, testAndSave, ensureBound, clearProviderKeys, setSheetOpen } = conn
  const initialBrand = getProviderBrand(view.providerId)
  const [providerId, setProviderId] = useState<ProviderId>(view.providerId)
  const [mode, setMode] = useState(view.mode)
  const [llmKey, setLlmKey] = useState('')
  const [ttsKey, setTtsKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(
    () => vault?.slots['cliproxy.baseUrl'] || initialBrand.defaultBaseUrl || '',
  )
  const [region, setRegion] = useState<MiniMaxRegion>(view.region)
  const [modelId, setModelId] = useState(view.modelId)

  const brand = getProviderBrand(providerId)

  const hintLlm = vault?.meta[llmSlotFor(providerId)]?.hint
  const hintTts = ttsSlotFor(providerId) ? vault?.meta[ttsSlotFor(providerId)!]?.hint : undefined

  const onSelectProvider = async (id: ProviderId) => {
    setProviderId(id)
    const b = getProviderBrand(id)
    setModelId(b.defaultModel)
    await setActive({
      providerId: id,
      modelId: b.defaultModel,
      region: b.defaultRegion || undefined,
    })
  }

  const onSaveBind = async () => {
    await setActive({
      mode,
      providerId,
      modelId,
      region: providerId === 'minimax' ? region : undefined,
    })
    if (mode === 'byok') {
      if (llmKey.trim()) {
        await testAndSave({
          providerId,
          purpose: 'llm',
          apiKey: llmKey,
          baseUrl: providerId === 'cliproxy' ? baseUrl : undefined,
          region: providerId === 'minimax' ? region : undefined,
          modelId,
        })
      }
      if (ttsKey.trim() && providerId === 'minimax') {
        await testAndSave({
          providerId,
          purpose: 'tts',
          apiKey: ttsKey,
          region,
        })
      }
      if (providerId === 'cliproxy' && baseUrl.trim() && !llmKey.trim()) {
        await testAndSave({
          providerId,
          purpose: 'llm',
          baseUrl,
          modelId,
        })
      }
      await ensureBound()
    }
  }

  return (
    <div className="connection-sheet-overlay" role="dialog" aria-modal="true" aria-label={t.title}>
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
            onClick={() => setMode('platform')}
          >
            {t.modePlatform}
          </button>
          <button
            type="button"
            className={mode === 'byok' ? 'is-active' : ''}
            onClick={() => setMode('byok')}
          >
            {t.modeByok}
          </button>
        </div>

        <div className="connection-sheet__brands">
          {brands.map(b => (
            <button
              key={b.id}
              type="button"
              className={`connection-brand${providerId === b.id ? ' is-active' : ''}`}
              onClick={() => onSelectProvider(b.id)}
            >
              <strong>{b.displayName}</strong>
              <span>{b.productLine}</span>
              {view.platform[b.id] && mode === 'platform' && (
                <em className="connection-brand__plat">demo</em>
              )}
            </button>
          ))}
        </div>

        <div className="connection-sheet__status">
          <span>{t.status}</span>
          <strong data-status={view.status}>
            {statusLabel[view.status]?.[language] || view.status}
            {view.hint ? ` · ${view.hint}` : ''}
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
                  placeholder={brand.keyHintLlm || t.placeholderKey}
                  value={llmKey}
                  onChange={e => setLlmKey(e.target.value)}
                />
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
                  placeholder={brand.keyHintTts || t.placeholderKey}
                  value={ttsKey}
                  onChange={e => setTtsKey(e.target.value)}
                />
              </label>
            )}

            {brand.needsBaseUrl && (
              <label>
                <span>{t.fieldBase}</span>
                <input
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={brand.defaultBaseUrl || 'http://127.0.0.1:8317'}
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
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
              ? '使用部署环境中的演示密钥。适合路演；个人用量请切换「我的密钥」。'
              : 'Uses server-side demo keys. Switch to My keys for personal usage.'}
          </p>
        )}

        <p className="connection-sheet__trust">{t.trust}</p>
        {message && <p className="connection-sheet__msg" role="status">{message}</p>}

        <footer className="connection-sheet__actions">
          {mode === 'byok' && (
            <button
              type="button"
              className="connection-sheet__ghost"
              disabled={busy}
              onClick={() => clearProviderKeys(providerId)}
            >
              {t.clear}
            </button>
          )}
          <button
            type="button"
            className="connection-sheet__primary"
            disabled={busy}
            onClick={onSaveBind}
          >
            {busy ? '…' : (mode === 'byok' ? t.saveBind : t.modePlatform)}
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
