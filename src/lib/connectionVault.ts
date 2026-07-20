/* =================================================================
   Client-side encrypted connection vault (BYOK credentials)
   Spec: docs/BYOK_BRANDING.md
   ================================================================= */

import type {
  ConnectionMode,
  ConnectionStatus,
  CredentialSlot,
  MiniMaxRegion,
  ProviderId,
} from './providerBrands'
import { PROVIDER_BRANDS } from './providerBrands'

const VAULT_STORAGE_KEY = 'abq_connection_vault_v1'
const DEVICE_KEY_STORAGE = 'abq_connection_vault_device_key_v1'
const BIND_SESSION_KEY = 'abq_connection_session_id'
const KEY_ALG = 'AES-GCM'

export type SlotMeta = {
  hint: string
  lastCheckedAt?: string
  lastStatus?: ConnectionStatus
}

export type VaultActive = {
  mode: ConnectionMode
  providerId: ProviderId
  modelId: string
  region?: MiniMaxRegion
  baseUrl?: string
}

export type VaultBlob = {
  v: 1
  slots: Partial<Record<CredentialSlot, string>>
  meta: Partial<Record<CredentialSlot, SlotMeta>>
  active: VaultActive
}

export type CatalogResponse = {
  providers: unknown[]
  platform: Partial<Record<ProviderId, boolean>> & {
    minimax?: boolean
    stepfun?: boolean
  }
  defaults: { providerId: ProviderId; modelId: string }
}

function getSubtle() {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Web Crypto is not available')
  return subtle
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(b => { binary += String.fromCharCode(b) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function maskHint(secret: string, tail = 4): string {
  const s = secret.trim()
  if (!s) return ''
  if (s.length <= tail) return '…'
  return `…${s.slice(-tail)}`
}

function defaultVault(): VaultBlob {
  const brand = PROVIDER_BRANDS[0]
  return {
    v: 1,
    slots: {},
    meta: {},
    active: {
      mode: 'platform',
      providerId: brand.id,
      modelId: brand.defaultModel,
      region: brand.defaultRegion ?? undefined,
    },
  }
}

async function loadOrCreateDeviceKey(): Promise<CryptoKey> {
  const subtle = getSubtle()
  if (typeof window === 'undefined') {
    return subtle.generateKey({ name: KEY_ALG, length: 256 }, false, ['encrypt', 'decrypt'])
  }
  const raw = window.localStorage.getItem(DEVICE_KEY_STORAGE)
  if (raw) {
    return subtle.importKey(
      'raw',
      toArrayBuffer(fromBase64Url(raw)),
      { name: KEY_ALG },
      false,
      ['encrypt', 'decrypt'],
    )
  }
  const key = await subtle.generateKey({ name: KEY_ALG, length: 256 }, true, ['encrypt', 'decrypt'])
  const exported = new Uint8Array(await subtle.exportKey('raw', key))
  window.localStorage.setItem(DEVICE_KEY_STORAGE, toBase64Url(exported))
  return subtle.importKey(
    'raw',
    toArrayBuffer(exported),
    { name: KEY_ALG },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptJson(data: VaultBlob, key: CryptoKey): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = await getSubtle().encrypt(
    { name: KEY_ALG, iv },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  )
  return JSON.stringify({
    v: 1,
    iv: toBase64Url(iv),
    ct: toBase64Url(new Uint8Array(ct)),
  })
}

async function decryptJson(envelope: string, key: CryptoKey): Promise<VaultBlob> {
  const parsed = JSON.parse(envelope) as { iv: string; ct: string }
  const plain = await getSubtle().decrypt(
    { name: KEY_ALG, iv: toArrayBuffer(fromBase64Url(parsed.iv)) },
    key,
    toArrayBuffer(fromBase64Url(parsed.ct)),
  )
  return JSON.parse(new TextDecoder().decode(plain)) as VaultBlob
}

export async function loadVault(): Promise<VaultBlob> {
  if (typeof window === 'undefined') return defaultVault()
  try {
    const raw = window.localStorage.getItem(VAULT_STORAGE_KEY)
    if (!raw) return defaultVault()
    // Backward-compat: plain JSON (dev) or encrypted envelope
    if (raw.startsWith('{') && raw.includes('"slots"')) {
      return { ...defaultVault(), ...JSON.parse(raw) as VaultBlob }
    }
    const key = await loadOrCreateDeviceKey()
    return await decryptJson(raw, key)
  } catch {
    return defaultVault()
  }
}

export async function saveVault(vault: VaultBlob): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const key = await loadOrCreateDeviceKey()
    const envelope = await encryptJson(vault, key)
    window.localStorage.setItem(VAULT_STORAGE_KEY, envelope)
  } catch (err) {
    console.warn('[connectionVault] save failed', err)
  }
}

export function getBindSessionId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(BIND_SESSION_KEY)
  } catch {
    return null
  }
}

export function setBindSessionId(id: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (!id) window.localStorage.removeItem(BIND_SESSION_KEY)
    else window.localStorage.setItem(BIND_SESSION_KEY, id)
  } catch {
    /* ignore */
  }
}

export async function fetchCatalog(): Promise<CatalogResponse | null> {
  try {
    const res = await fetch('/api/connections/catalog')
    if (!res.ok) return null
    return (await res.json()) as CatalogResponse
  } catch {
    return null
  }
}

export async function testConnection(body: {
  providerId: ProviderId
  purpose: 'llm' | 'tts'
  apiKey?: string
  baseUrl?: string
  region?: MiniMaxRegion
  modelId?: string
}): Promise<{ ok: boolean; status: ConnectionStatus; message: string; latencyMs?: number }> {
  const res = await fetch('/api/connections/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as {
    ok?: boolean
    status?: ConnectionStatus
    message?: string
    latencyMs?: number
    detail?: string
  }
  if (!res.ok) {
    return {
      ok: false,
      status: 'unreachable',
      message: data.detail || data.message || `HTTP ${res.status}`,
    }
  }
  return {
    ok: Boolean(data.ok),
    status: (data.status as ConnectionStatus) || (data.ok ? 'valid' : 'invalid'),
    message: data.message || '',
    latencyMs: data.latencyMs,
  }
}

export type BindSessionView = {
  connectionSessionId: string
  providerId?: string
  modelId?: string
  region?: string | null
  hint: string
  hasLlmKey?: boolean
  expiresAt?: string
}

export async function fetchBindSession(sessionId: string | null): Promise<BindSessionView | null> {
  if (!sessionId) return null
  try {
    const res = await fetch(`/api/connections/bind/${encodeURIComponent(sessionId)}`)
    if (!res.ok) return null
    const data = await res.json() as BindSessionView
    if (!data.connectionSessionId) return null
    return {
      connectionSessionId: data.connectionSessionId,
      providerId: data.providerId,
      modelId: data.modelId,
      region: data.region,
      hint: data.hint || '',
      hasLlmKey: data.hasLlmKey,
      expiresAt: data.expiresAt,
    }
  } catch {
    return null
  }
}

export async function bindConnection(body: {
  providerId: ProviderId
  modelId?: string
  llmKey?: string
  ttsKey?: string
  baseUrl?: string
  region?: MiniMaxRegion
}): Promise<BindSessionView | null> {
  const res = await fetch('/api/connections/bind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  const data = await res.json() as BindSessionView
  setBindSessionId(data.connectionSessionId)
  return {
    connectionSessionId: data.connectionSessionId,
    providerId: data.providerId,
    modelId: data.modelId,
    region: data.region,
    hint: data.hint || '',
    hasLlmKey: data.hasLlmKey,
    expiresAt: data.expiresAt,
  }
}

export async function unbindConnection(sessionId: string | null): Promise<void> {
  if (!sessionId) {
    setBindSessionId(null)
    return
  }
  try {
    await fetch(`/api/connections/bind/${sessionId}`, { method: 'DELETE' })
  } catch {
    /* ignore */
  }
  setBindSessionId(null)
}
