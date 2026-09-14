import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../App.tsx'), 'utf8')
const quotaHook = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../hooks/useQuota.ts'), 'utf8')

describe('play-QA wiring in App', () => {
  it('URL surface and landing CTAs reach Direct/Crew before Story', () => {
    assert.match(app, /applyPlaySurfaceToStorage/)
    assert.match(app, /toDirectChatMemoryWire/)
    assert.match(app, /app-shell--chat-paper/)
    assert.match(app, /bubbleFromDirectPayload/)
    assert.match(app, /bubblesFromCrewPayload/)
    assert.match(app, /getDirectWayfinders/)
    assert.match(app, /chat-header__frame/)
    assert.match(app, /isInspectableThinking/)
    assert.doesNotMatch(app, /我需要你的建议|I could use your advice/)
    assert.match(app, /onEnterDirect/)
    assert.match(app, /onEnterCrew/)
    assert.match(app, /onCrew=/)
    assert.match(app, /PlayModeBar/)
    assert.doesNotMatch(app, /NightStartCta/)
  })

  it('open quota does not wall 说/做/观察 or pulse 额度用尽', () => {
    assert.match(app, /quotaBlocksPlay/)
    assert.match(app, /quota\.open/)
    assert.match(quotaHook, /open:\s*(Boolean\(data\.open\)|data\.open === true|Boolean\(data\.open\)\s*\|\|)/)
    assert.doesNotMatch(app, /继续这夜|进入这一夜|这一夜/)
    assert.doesNotMatch(app, /NIGHT \{/)
  })
})
