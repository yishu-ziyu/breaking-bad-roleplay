import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decryptString, derivePrivacyKey, encryptString, isEncryptedEnvelope } from './privacyVault.ts'

describe('privacyVault', () => {
  it('encrypts text into an opaque envelope and decrypts with the same login-derived key', async () => {
    const key = await derivePrivacyKey('player@example.com', 'password-123')
    const encrypted = await encryptString('private chat turn', key)

    assert.ok(isEncryptedEnvelope(encrypted))
    assert.ok(!encrypted.includes('private chat turn'))
    assert.equal(await decryptString(encrypted, key), 'private chat turn')
  })

  it('does not decrypt with a different password-derived key', async () => {
    const key = await derivePrivacyKey('player@example.com', 'password-123')
    const wrongKey = await derivePrivacyKey('player@example.com', 'different-password')
    const encrypted = await encryptString('private chat turn', key)

    await assert.rejects(() => decryptString(encrypted, wrongKey))
  })
})
