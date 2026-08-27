import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  APODEX_DEFAULT_BASE_URL,
  APODEX_DEFAULT_MODEL,
  APODEX_PROVIDER_ID,
  hasUsableApodexKey,
  isApodexBaseUrl,
  liveProviderFromEnv,
  resolveApodexModel,
  resolveRuntimeMode,
} from "../src/providers.ts"

const FAKE_KEY = "test-apodex-key-not-real"

describe("Apodex env resolution", () => {
  it("stays on Faux when no usable key is present", () => {
    assert.equal(liveProviderFromEnv({}), undefined)
    assert.equal(resolveRuntimeMode(undefined, {}), "faux")
    assert.equal(hasUsableApodexKey({}), false)
    assert.equal(hasUsableApodexKey({ APODEX_API_KEY: "test-key" }), false)
    assert.equal(hasUsableApodexKey({ APODEX_API_KEY: "short" }), false)
  })

  it("prefers dedicated APODEX_API_KEY as openai-compatible / apodex-1.1", () => {
    const provider = liveProviderFromEnv({
      APODEX_API_KEY: FAKE_KEY,
      OPENAI_API_KEY: "sk-openai-should-not-win-here",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
    })
    assert.equal(provider?.provider_id, APODEX_PROVIDER_ID)
    assert.equal(provider?.provider_id, "openai-compatible")
    assert.equal(provider?.model_id, APODEX_DEFAULT_MODEL)
    assert.equal(provider?.model_id, "apodex-1.1")
    assert.equal(provider?.base_url, APODEX_DEFAULT_BASE_URL)
    assert.equal(provider?.api_key, FAKE_KEY)
    assert.equal(resolveRuntimeMode(undefined, { APODEX_API_KEY: FAKE_KEY }), "pi")
    assert.equal(hasUsableApodexKey({ APODEX_API_KEY: FAKE_KEY }), true)
  })

  it("accepts OPENAI_API_KEY + OPENAI_BASE_URL when they point at Apodex", () => {
    const provider = liveProviderFromEnv({
      OPENAI_API_KEY: FAKE_KEY,
      OPENAI_BASE_URL: "https://api.apodex.ai/v1/",
    })
    assert.equal(provider?.provider_id, "openai-compatible")
    assert.equal(provider?.model_id, "apodex-1.1")
    assert.equal(provider?.base_url, "https://api.apodex.ai/v1")
    assert.equal(resolveRuntimeMode(undefined, {
      OPENAI_API_KEY: FAKE_KEY,
      OPENAI_BASE_URL: "https://api.apodex.ai/v1",
    }), "pi")
    assert.equal(hasUsableApodexKey({
      OPENAI_API_KEY: FAKE_KEY,
      OPENAI_BASE_URL: "https://api.apodex.ai/v1",
    }), false)
  })

  it("does not treat a non-Apodex OpenAI base as Apodex", () => {
    const provider = liveProviderFromEnv({
      OPENAI_API_KEY: FAKE_KEY,
      OPENAI_BASE_URL: "https://api.openai.com/v1",
    })
    assert.equal(provider?.provider_id, "openai")
    assert.notEqual(provider?.model_id, "apodex-1.1")
  })

  it("honors APODEX_MODEL / APODEX_BASE_URL for the 1.1 core family only", () => {
    const mini = liveProviderFromEnv({
      APODEX_API_KEY: FAKE_KEY,
      APODEX_MODEL: "apodex-1.1-mini",
      APODEX_BASE_URL: "https://api.apodex.ai/v1/",
    })
    assert.equal(mini?.model_id, "apodex-1.1-mini")
    assert.equal(mini?.base_url, "https://api.apodex.ai/v1")

    const forced = liveProviderFromEnv({
      APODEX_API_KEY: FAKE_KEY,
      APODEX_MODEL: "apodex-1-1-deep-research",
    })
    assert.equal(forced?.model_id, "apodex-1.1")
  })

  it("maps unknown / deep-research ids back to apodex-1.1", () => {
    assert.equal(resolveApodexModel("apodex-1.1"), "apodex-1.1")
    assert.equal(resolveApodexModel("apodex-1.1-mini"), "apodex-1.1-mini")
    assert.equal(resolveApodexModel("apodex-1-1-deep-research"), "apodex-1.1")
    assert.equal(resolveApodexModel("apodex-1.1-deep-research"), "apodex-1.1")
    assert.equal(resolveApodexModel(""), "apodex-1.1")
    assert.ok(isApodexBaseUrl("https://api.apodex.ai/v1"))
    assert.equal(isApodexBaseUrl("https://api.openai.com/v1"), false)
  })
})
