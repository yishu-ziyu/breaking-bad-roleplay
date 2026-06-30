/* =================================================================
   ABQ Roleplay Lab — client-side cloud privacy vault
   ================================================================= */

export const PRIVACY_ENVELOPE_PREFIX = 'abqenc:v1:'
export const PRIVACY_KEY_UPDATED_EVENT = 'abq:privacy-key-updated'

const STORAGE_PREFIX = 'abq_privacy_key_v1:'
const KEY_DERIVATION_ITERATIONS = 210_000
const KEY_ALGORITHM = 'AES-GCM'

type PrivacyEnvelope = {
  v: 1
  alg: 'AES-GCM'
  iv: string
  ct: string
}

type PrivacyUser = {
  id: string
  email?: string | null
}

function getSubtle() {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Web Crypto is not available')
  return subtle
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`
}

function normalizeEmail(email?: string | null) {
  return (email ?? '').trim().toLowerCase()
}

export function isEncryptedEnvelope(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PRIVACY_ENVELOPE_PREFIX)
}

export async function derivePrivacyKey(email: string, password: string): Promise<CryptoKey> {
  const subtle = getSubtle()
  const encoder = new TextEncoder()
  const baseKey = await subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(`abq-roleplay-lab:cloud-profile:v1:${normalizeEmail(email)}`),
      iterations: KEY_DERIVATION_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: KEY_ALGORITHM, length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function storePrivacyKey(userId: string, key: CryptoKey) {
  if (typeof window === 'undefined') return
  const raw = await getSubtle().exportKey('raw', key)
  window.localStorage.setItem(storageKey(userId), toBase64Url(new Uint8Array(raw)))
  window.dispatchEvent(new CustomEvent(PRIVACY_KEY_UPDATED_EVENT, { detail: { userId } }))
}

export async function deriveAndStorePrivacyKey(user: PrivacyUser, password: string) {
  if (!user.email) return
  const key = await derivePrivacyKey(user.email, password)
  await storePrivacyKey(user.id, key)
}

export async function loadStoredPrivacyKey(userId: string): Promise<CryptoKey | null> {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(storageKey(userId))
  if (!raw) return null
  return getSubtle().importKey(
    'raw',
    toArrayBuffer(fromBase64Url(raw)),
    { name: KEY_ALGORITHM },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function clearStoredPrivacyKey(userId: string) {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(storageKey(userId))
}

export async function encryptString(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await getSubtle().encrypt(
    { name: KEY_ALGORITHM, iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  const envelope: PrivacyEnvelope = {
    v: 1,
    alg: KEY_ALGORITHM,
    iv: toBase64Url(iv),
    ct: toBase64Url(new Uint8Array(ciphertext)),
  }
  return `${PRIVACY_ENVELOPE_PREFIX}${toBase64Url(new TextEncoder().encode(JSON.stringify(envelope)))}`
}

export async function decryptString(ciphertext: string, key: CryptoKey): Promise<string> {
  if (!isEncryptedEnvelope(ciphertext)) return ciphertext
  const encoded = ciphertext.slice(PRIVACY_ENVELOPE_PREFIX.length)
  const envelope = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as PrivacyEnvelope
  if (envelope.v !== 1 || envelope.alg !== KEY_ALGORITHM) {
    throw new Error('Unsupported privacy envelope')
  }
  const plaintext = await getSubtle().decrypt(
    { name: KEY_ALGORITHM, iv: toArrayBuffer(fromBase64Url(envelope.iv)) },
    key,
    toArrayBuffer(fromBase64Url(envelope.ct)),
  )
  return new TextDecoder().decode(plaintext)
}

export async function decryptMaybeString(value: string, key: CryptoKey | null | undefined): Promise<string> {
  if (!isEncryptedEnvelope(value)) return value
  if (!key) throw new Error('Cloud privacy key is locked')
  return decryptString(value, key)
}

export function encryptedFactsEnvelope(ciphertext: string): Array<Record<string, unknown>> {
  return [{ __abq_encrypted: true, payload: ciphertext }]
}

export function getEncryptedFactsPayload(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 1) return null
  const first = value[0] as Record<string, unknown>
  if (first.__abq_encrypted !== true || typeof first.payload !== 'string') return null
  return first.payload
}
