/* =================================================================
   useConnection — BYOK active line + vault + bind session
   ================================================================= */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  bindConnection,
  fetchBindSession,
  fetchCatalog,
  getBindSessionId,
  loadVault,
  saveVault,
  setBindSessionId,
  testConnection,
  unbindConnection,
  type VaultBlob,
  type VaultActive,
} from '../lib/connectionVault'
import {
  baseUrlSlotFor,
  brandsForMode,
  formatProviderChip,
  getProviderBrand,
  isProviderId,
  llmSlotFor,
  ttsSlotFor,
  type ConnectionMode,
  type ConnectionStatus,
  type MiniMaxRegion,
  type ProviderId,
  PLATFORM_PROVIDER_IDS,
  PROVIDER_BRANDS,
} from '../lib/providerBrands'

export type ConnectionView = {
  mode: ConnectionMode
  providerId: ProviderId
  modelId: string
  region: MiniMaxRegion
  baseUrl: string
  status: ConnectionStatus
  chipLabel: string
  hint: string
  connectionSessionId: string | null
  platform: Record<'minimax' | 'stepfun', boolean>
  canStart: boolean
  hasSavedLlmKey: boolean
}

export function useConnection() {
  const [vault, setVault] = useState<VaultBlob | null>(null)
  const [platform, setPlatform] = useState<Record<'minimax' | 'stepfun', boolean>>({
    minimax: true,
    stepfun: true,
  })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [connectionSessionId, setSessionId] = useState<string | null>(() => getBindSessionId())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [v, catalog] = await Promise.all([loadVault(), fetchCatalog()])
      if (cancelled) return
      if (catalog?.platform) {
        setPlatform({
          minimax: Boolean(catalog.platform.minimax),
          stepfun: Boolean(catalog.platform.stepfun),
        })
      }
      // Migrate removed CLIProxy / unknown ids; keep valid BYOK presets.
      const rawPid = String(v.active.providerId || '')
      if (rawPid === 'cliproxy' || !isProviderId(rawPid)) {
        v.active.providerId = (catalog?.defaults?.providerId as ProviderId) || 'stepfun'
        v.active.modelId = catalog?.defaults?.modelId || 'step-3.7-flash'
      } else if (v.active.providerId === 'stepfun' && (
        !v.active.modelId || v.active.modelId === 'step-2-16k'
      )) {
        v.active.modelId = 'step-3.7-flash'
      }
      // Platform mode: only coerce invalid ids. Keep user's MiniMax/StepFun pick.
      if (v.active.mode === 'platform') {
        if (!PLATFORM_PROVIDER_IDS.includes(v.active.providerId)) {
          v.active.providerId = (catalog?.defaults?.providerId as ProviderId) || 'stepfun'
          v.active.modelId = catalog?.defaults?.modelId || 'step-3.7-flash'
        }
      }

      // Drop stale bind tokens left from a previous process/TTL.
      const existingSid = getBindSessionId()
      if (v.active.mode === 'platform') {
        if (existingSid) {
          await unbindConnection(existingSid)
          if (!cancelled) setSessionId(null)
        }
      } else if (existingSid) {
        const alive = await fetchBindSession(existingSid)
        if (!alive) {
          setBindSessionId(null)
          if (!cancelled) setSessionId(null)
        } else if (
          alive.providerId
          && alive.providerId !== v.active.providerId
        ) {
          await unbindConnection(existingSid)
          if (!cancelled) setSessionId(null)
        } else if (!cancelled) {
          setSessionId(alive.connectionSessionId)
        }
      }

      setVault(v)
    })()
    return () => { cancelled = true }
  }, [])

  const persist = useCallback(async (next: VaultBlob) => {
    setVault(next)
    await saveVault(next)
  }, [])

  const active: VaultActive = vault?.active ?? {
    mode: 'platform',
    providerId: 'stepfun',
    modelId: 'step-3.7-flash',
    region: 'cn',
  }

  const brand = getProviderBrand(active.providerId)
  const llmSlot = llmSlotFor(active.providerId)
  const meta = vault?.meta[llmSlot]
  const hasSavedLlmKey = Boolean(vault?.slots[llmSlot])
  const status: ConnectionStatus = useMemo(() => {
    if (active.mode === 'platform') {
      const pid = active.providerId
      if (pid === 'minimax' || pid === 'stepfun') {
        return platform[pid] ? 'valid' : 'empty'
      }
      return 'empty'
    }
    if (connectionSessionId && (meta?.lastStatus === 'valid' || hasSavedLlmKey)) {
      return meta?.lastStatus === 'invalid' || meta?.lastStatus === 'quota' || meta?.lastStatus === 'unreachable'
        ? meta.lastStatus
        : (meta?.lastStatus || 'valid')
    }
    return meta?.lastStatus || (hasSavedLlmKey ? 'saved' : 'empty')
  }, [active.mode, active.providerId, platform, meta, hasSavedLlmKey, connectionSessionId])

  const canStart =
    active.mode === 'platform'
      ? (active.providerId === 'minimax' || active.providerId === 'stepfun')
        && Boolean(platform[active.providerId])
      : hasSavedLlmKey && status !== 'invalid' && status !== 'quota' && status !== 'unreachable'

  const view: ConnectionView = {
    mode: active.mode,
    providerId: active.providerId,
    modelId: active.modelId,
    region: active.region || 'cn',
    baseUrl: active.baseUrl || brand.defaultBaseUrl || '',
    status,
    chipLabel: formatProviderChip(brand, active.modelId),
    hint: meta?.hint || '',
    connectionSessionId,
    platform,
    canStart,
    hasSavedLlmKey,
  }

  const setActive = useCallback(async (patch: Partial<VaultActive>) => {
    if (!vault) return
    const next: VaultBlob = {
      ...vault,
      active: { ...vault.active, ...patch },
    }
    await persist(next)
  }, [vault, persist])

  const saveSlot = useCallback(async (
    slot: keyof NonNullable<VaultBlob['slots']>,
    value: string,
    statusAfter?: ConnectionStatus,
  ) => {
    if (!vault) return
    const trimmed = value.trim()
    const slots = { ...vault.slots }
    const metaMap = { ...vault.meta }
    if (!trimmed) {
      delete slots[slot]
      delete metaMap[slot]
    } else {
      slots[slot] = trimmed
      metaMap[slot] = {
        hint: trimmed.length > 4 ? `…${trimmed.slice(-4)}` : '…',
        lastCheckedAt: new Date().toISOString(),
        lastStatus: statusAfter || 'saved',
      }
    }
    await persist({ ...vault, slots, meta: metaMap })
  }, [vault, persist])

  const markSlotStatus = useCallback(async (
    slot: string,
    statusAfter: ConnectionStatus,
  ) => {
    if (!vault) return
    const prev = vault.meta[slot]
    if (!prev && !vault.slots[slot]) return
    await persist({
      ...vault,
      meta: {
        ...vault.meta,
        [slot]: {
          hint: prev?.hint || '…',
          lastCheckedAt: new Date().toISOString(),
          lastStatus: statusAfter,
        },
      },
    })
  }, [vault, persist])

  const testAndSave = useCallback(async (opts: {
    providerId: ProviderId
    purpose: 'llm' | 'tts'
    apiKey?: string
    baseUrl?: string
    region?: MiniMaxRegion
    modelId?: string
    /** When true (default), only write key material on ok. Status always updates when a key was tested. */
    persistKey?: boolean
  }) => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await testConnection(opts)
      setMessage(result.message)
      const persistKey = opts.persistKey !== false
      if (opts.purpose === 'llm' && opts.apiKey) {
        const slot = llmSlotFor(opts.providerId)
        if (result.ok && persistKey) {
          await saveSlot(slot, opts.apiKey, result.status)
        } else if (!result.ok && vault?.slots[slot]) {
          // Keep previous good key; only stamp failure status on existing slot.
          await markSlotStatus(slot, result.status)
        }
      }
      if (opts.purpose === 'tts' && opts.apiKey) {
        const ttsSlot = ttsSlotFor(opts.providerId)
        if (ttsSlot) {
          if (result.ok && persistKey) {
            await saveSlot(ttsSlot, opts.apiKey, result.status)
          } else if (!result.ok && vault?.slots[ttsSlot]) {
            await markSlotStatus(ttsSlot, result.status)
          }
        }
      }
      if (result.ok && opts.baseUrl && baseUrlSlotFor(opts.providerId)) {
        await saveSlot(baseUrlSlotFor(opts.providerId)!, opts.baseUrl, result.status)
      }
      return result
    } finally {
      setBusy(false)
    }
  }, [saveSlot, markSlotStatus, vault])

  const ensureBound = useCallback(async (opts?: {
    /** Fresh keys from the sheet - vault React state may lag one tick after save. */
    llmKey?: string
    ttsKey?: string
    baseUrl?: string
    providerId?: ProviderId
    modelId?: string
    region?: MiniMaxRegion
    mode?: ConnectionMode
    force?: boolean
  }): Promise<string | null> => {
    if (!vault) return connectionSessionId
    const mode = opts?.mode ?? vault.active.mode
    if (mode === 'platform') {
      if (connectionSessionId) {
        await unbindConnection(connectionSessionId)
        setSessionId(null)
      }
      return null
    }
    const pid = opts?.providerId ?? vault.active.providerId
    const modelId = opts?.modelId ?? vault.active.modelId
    const region = opts?.region ?? vault.active.region
    const brandNow = getProviderBrand(pid)
    const llmKey = (opts?.llmKey?.trim() || vault.slots[llmSlotFor(pid)] || '').trim()
    const ttsKey = (
      opts?.ttsKey?.trim()
      || (ttsSlotFor(pid) ? vault.slots[ttsSlotFor(pid)!] : undefined)
      || ''
    ).trim() || undefined
    const baseFromSlot = baseUrlSlotFor(pid) ? vault.slots[baseUrlSlotFor(pid)!] : undefined
    const baseUrl = (
      opts?.baseUrl
      || vault.active.baseUrl
      || baseFromSlot
      || brandNow.defaultBaseUrl
      || ''
    ).trim() || undefined
    if (!llmKey) {
      setMessage('Missing API key')
      return null
    }
    if (brandNow.needsBaseUrl && !baseUrl) {
      setMessage('Missing base URL')
      return null
    }

    // Reuse live session when provider + model still match (unless forced rebind).
    if (!opts?.force && connectionSessionId) {
      const alive = await fetchBindSession(connectionSessionId)
      if (
        alive
        && alive.providerId === pid
        && (!modelId || !alive.modelId || alive.modelId === modelId)
      ) {
        setSessionId(alive.connectionSessionId)
        setBindSessionId(alive.connectionSessionId)
        return alive.connectionSessionId
      }
      await unbindConnection(connectionSessionId)
      setSessionId(null)
    } else if (opts?.force && connectionSessionId) {
      await unbindConnection(connectionSessionId)
      setSessionId(null)
    }

    const bound = await bindConnection({
      providerId: pid,
      modelId,
      llmKey,
      ttsKey,
      baseUrl,
      region,
    })
    if (!bound) {
      setMessage('Bind failed')
      return null
    }
    setSessionId(bound.connectionSessionId)
    setBindSessionId(bound.connectionSessionId)
    await markSlotStatus(llmSlotFor(pid), 'valid')
    return bound.connectionSessionId
  }, [vault, connectionSessionId, markSlotStatus])

  const clearProviderKeys = useCallback(async (providerId: ProviderId) => {
    if (!vault) return
    if (connectionSessionId) {
      await unbindConnection(connectionSessionId)
      setSessionId(null)
    }
    const slots = { ...vault.slots }
    const metaMap = { ...vault.meta }
    const toClear = [llmSlotFor(providerId), ttsSlotFor(providerId), baseUrlSlotFor(providerId)]
    for (const s of toClear) {
      if (!s) continue
      delete slots[s]
      delete metaMap[s]
    }
    await persist({ ...vault, slots, meta: metaMap })
    setMessage(null)
  }, [vault, connectionSessionId, persist])

  const brands = useMemo(
    () => brandsForMode(active.mode === 'platform' ? 'platform' : 'byok'),
    [active.mode],
  )

  return {
    vault,
    view,
    brands,
    allBrands: PROVIDER_BRANDS,
    sheetOpen,
    setSheetOpen,
    busy,
    message,
    setMessage,
    setActive,
    saveSlot,
    testAndSave,
    ensureBound,
    clearProviderKeys,
    connectionSessionId,
  }
}

export type UseConnectionReturn = ReturnType<typeof useConnection>
