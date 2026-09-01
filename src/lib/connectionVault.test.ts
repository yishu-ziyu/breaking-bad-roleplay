/** P5① (full-stack review): device key must be non-extractable and never
 * live in localStorage next to the ciphertext it protects. */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadVault,
  saveVault,
  setVaultKeyStoreForTests,
  type VaultBlob,
  type VaultKeyStore,
} from './connectionVault'

const VAULT_LS_KEY = 'abq_connection_vault_v1'
const DEVICE_LS_KEY = 'abq_connection_vault_device_key_v1'

function makeLocalStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
  }
}

function installDom() {
  const ls = makeLocalStorage()
  ;(globalThis as Record<string, unknown>).window = { localStorage: ls }
  return ls
}

function memoryKeyStore(): VaultKeyStore & { current: CryptoKey | null } {
  const box = { current: null as CryptoKey | null }
  return {
    current: null,
    async get() { return box.current },
    async put(k: CryptoKey) { box.current = k },
  }
}

function b64url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((b) => { binary += String.fromCharCode(b) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function sampleVault(): VaultBlob {
  return {
    v: 1,
    slots: { minimax_llm: 'sk-secret-provider-key' },
    meta: {},
    active: { mode: 'byok', providerId: 'minimax', modelId: 'MiniMax-M3' },
  }
}

afterEach(() => {
  setVaultKeyStoreForTests(undefined)
  delete (globalThis as Record<string, unknown>).window
})

describe('connectionVault device key (P5①)', () => {
  it('stores a NON-extractable key outside localStorage and round-trips', async () => {
    const ls = installDom()
    const store = memoryKeyStore()
    setVaultKeyStoreForTests(store)

    await saveVault(sampleVault())

    const key = await store.get()
    assert.ok(key, 'device key must be persisted in the key store')
    assert.equal(key!.extractable, false, 'v2 device key must be non-extractable')
    assert.equal(ls.map.has(DEVICE_LS_KEY), false, 'raw key material must NEVER be written to localStorage')
    // Vault envelope (ciphertext) may live in localStorage.
    assert.ok(ls.map.has(VAULT_LS_KEY))
    assert.ok(!ls.map.get(VAULT_LS_KEY)!.includes('sk-secret-provider-key'))

    const loaded = await loadVault()
    assert.deepEqual(loaded.slots, { minimax_llm: 'sk-secret-provider-key' })
  })

  it('migrates a v1 vault (raw key in localStorage) to v2 and deletes the raw key', async () => {
    const ls = installDom()
    const subtle = globalThis.crypto.subtle

    // Forge the old v1 artefacts: exportable raw key in localStorage and an
    // envelope encrypted with it.
    const v1Key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const raw = new Uint8Array(await subtle.exportKey('raw', v1Key))
    ls.map.set(DEVICE_LS_KEY, b64url(raw))
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
    const ct = new Uint8Array(await subtle.encrypt(
      { name: 'AES-GCM', iv },
      v1Key,
      new TextEncoder().encode(JSON.stringify(sampleVault())),
    ))
    ls.map.set(VAULT_LS_KEY, JSON.stringify({ v: 1, iv: b64url(iv), ct: b64url(ct) }))

    const store = memoryKeyStore()
    setVaultKeyStoreForTests(store)

    const loaded = await loadVault()
    assert.deepEqual(loaded.slots, { minimax_llm: 'sk-secret-provider-key' }, 'v1 vault must still load')
    assert.equal(ls.map.has(DEVICE_LS_KEY), false, 'migration must destroy the exported raw key')
    const migratedKey = await store.get()
    assert.ok(migratedKey && migratedKey.extractable === false)
    // Re-loaded through the v2 path (no v1 key left to fall back to).
    const again = await loadVault()
    assert.deepEqual(again.slots, loaded.slots)
  })

  it('returns the default vault when nothing was ever stored', async () => {
    installDom()
    setVaultKeyStoreForTests(memoryKeyStore())
    const vault = await loadVault()
    assert.equal(vault.active.mode, 'platform')
    assert.deepEqual(vault.slots, {})
  })
})
