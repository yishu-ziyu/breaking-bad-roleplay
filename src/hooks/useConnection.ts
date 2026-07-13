/* =================================================================
   useConnection — BYOK active line + vault + bind session
   ================================================================= */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  bindConnection,
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
  formatProviderChip,
  getProviderBrand,
  llmSlotFor,
  ttsSlotFor,
  type ConnectionMode,
  type ConnectionStatus,
  type MiniMaxRegion,
  type ProviderId,
  PROVIDER_BRANDS,
} from '../lib/providerBrands'

export type ConnectionView = {
  mode: ConnectionMode
  providerId: ProviderId
  modelId: string
  region: MiniMaxRegion
  status: ConnectionStatus
  chipLabel: string
  hint: string
  connectionSessionId: string | null
  platform: Record<ProviderId, boolean>
  canStart: boolean
}

export function useConnection() {
  const [vault, setVault] = useState<VaultBlob | null>(null)
  const [platform, setPlatform] = useState<Record<ProviderId, boolean>>({
    minimax: true,
    stepfun: false,
    cliproxy: true,
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
        setPlatform(catalog.platform as Record<ProviderId, boolean>)
      }
      if (catalog?.defaults && v.active.mode === 'platform') {
        v.active.providerId = catalog.defaults.providerId
        v.active.modelId = catalog.defaults.modelId
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
    providerId: 'minimax',
    modelId: 'MiniMax-M3',
    region: 'cn',
  }

  const brand = getProviderBrand(active.providerId)
  const llmSlot = llmSlotFor(active.providerId)
  const meta = vault?.meta[llmSlot]
  const status: ConnectionStatus = useMemo(() => {
    if (active.mode === 'platform') {
      return platform[active.providerId] ? 'valid' : 'empty'
    }
    return meta?.lastStatus || (vault?.slots[llmSlot] ? 'saved' : 'empty')
  }, [active.mode, active.providerId, platform, meta, vault, llmSlot])

  const canStart =
    active.mode === 'platform'
      ? Boolean(platform[active.providerId])
      : status === 'valid' || status === 'saved'

  const view: ConnectionView = {
    mode: active.mode,
    providerId: active.providerId,
    modelId: active.modelId,
    region: active.region || 'cn',
    status,
    chipLabel: formatProviderChip(brand, active.modelId),
    hint: meta?.hint || '',
    connectionSessionId,
    platform,
    canStart,
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

  const testAndSave = useCallback(async (opts: {
    providerId: ProviderId
    purpose: 'llm' | 'tts'
    apiKey?: string
    baseUrl?: string
    region?: MiniMaxRegion
    modelId?: string
  }) => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await testConnection(opts)
      setMessage(result.message)
      if (opts.purpose === 'llm' && opts.apiKey) {
        await saveSlot(llmSlotFor(opts.providerId), opts.apiKey, result.status)
      }
      if (opts.purpose === 'tts' && opts.apiKey && ttsSlotFor(opts.providerId)) {
        await saveSlot(ttsSlotFor(opts.providerId)!, opts.apiKey, result.status)
      }
      if (opts.baseUrl) {
        await saveSlot('cliproxy.baseUrl', opts.baseUrl, result.status)
      }
      return result
    } finally {
      setBusy(false)
    }
  }, [saveSlot])

  const ensureBound = useCallback(async (): Promise<string | null> => {
    if (!vault) return connectionSessionId
    if (vault.active.mode === 'platform') {
      // Platform uses server env; clear any stale bind
      if (connectionSessionId) {
        await unbindConnection(connectionSessionId)
        setSessionId(null)
      }
      return null
    }
    const pid = vault.active.providerId
    const llmKey = vault.slots[llmSlotFor(pid)]
    const ttsKey = ttsSlotFor(pid) ? vault.slots[ttsSlotFor(pid)!] : undefined
    const baseUrl = vault.slots['cliproxy.baseUrl']
    if (pid !== 'cliproxy' && !llmKey) {
      setMessage('Missing API key')
      return null
    }
    const bound = await bindConnection({
      providerId: pid,
      modelId: vault.active.modelId,
      llmKey: llmKey || undefined,
      ttsKey,
      baseUrl: baseUrl || (pid === 'cliproxy' ? brand.defaultBaseUrl : undefined),
      region: vault.active.region,
    })
    if (!bound) {
      setMessage('Bind failed')
      return null
    }
    setSessionId(bound.connectionSessionId)
    setBindSessionId(bound.connectionSessionId)
    return bound.connectionSessionId
  }, [vault, connectionSessionId, brand.defaultBaseUrl])

  const clearProviderKeys = useCallback(async (providerId: ProviderId) => {
    if (!vault) return
    if (connectionSessionId) {
      await unbindConnection(connectionSessionId)
      setSessionId(null)
    }
    const slots = { ...vault.slots }
    const metaMap = { ...vault.meta }
    const toClear = [llmSlotFor(providerId), ttsSlotFor(providerId), providerId === 'cliproxy' ? 'cliproxy.baseUrl' as const : null]
    for (const s of toClear) {
      if (!s) continue
      delete slots[s]
      delete metaMap[s]
    }
    await persist({ ...vault, slots, meta: metaMap })
    setMessage(null)
  }, [vault, connectionSessionId, persist])

  return {
    vault,
    view,
    brands: PROVIDER_BRANDS,
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
