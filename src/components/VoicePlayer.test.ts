import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { VoicePlayer } from './VoicePlayer.tsx'
import { pickVoice, createPlayHandler, handleVoiceToggle, VOICE_PROFILES } from '../lib/voicePlayerHelpers.ts'

// node 环境无 SpeechSynthesisUtterance / speechSynthesis，需 mock
class MockUtterance {
  text: string
  lang = ''
  voice: unknown = null
  pitch = 1
  rate = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

const originalSynth = (globalThis as { speechSynthesis?: unknown }).speechSynthesis
const originalCtor = (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance

before(() => {
  ;(globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = MockUtterance as unknown
})

after(() => {
  if (originalSynth === undefined) {
    delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis
  } else {
    ;(globalThis as { speechSynthesis?: unknown }).speechSynthesis = originalSynth
  }
  if (originalCtor === undefined) {
    delete (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance
  } else {
    ;(globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = originalCtor
  }
})

describe('VoicePlayer (speechSynthesis)', () => {
  it('renders enabled button when speechSynthesis available', () => {
    ;(globalThis as { speechSynthesis?: unknown }).speechSynthesis = {
      speak: () => {},
      getVoices: () => [],
      cancel: () => {},
    }
    const html = renderToStaticMarkup(
      createElement(VoicePlayer, { text: 'hello', characterId: 'walter', language: 'en' })
    )
    assert.ok(
      !html.includes('voice-player--disabled'),
      'button should NOT be disabled when speechSynthesis is available'
    )
  })

  it('renders disabled button when speechSynthesis unavailable', () => {
    ;(globalThis as { speechSynthesis?: unknown }).speechSynthesis = undefined
    const html = renderToStaticMarkup(
      createElement(VoicePlayer, { text: 'hello', characterId: 'walter', language: 'en' })
    )
    assert.ok(
      html.includes('voice-player--disabled'),
      'button should be disabled when speechSynthesis is unavailable'
    )
  })

  it('click triggers speechSynthesis.speak with utterance.text === "hello"', () => {
    let spoken: { text?: string } | null = null
    const synth = {
      speak: (u: { text?: string }) => {
        spoken = u
      },
      getVoices: () => [],
      cancel: () => {},
    }
    const play = createPlayHandler('hello', 'walter', 'en', synth)
    play()
    assert.ok(spoken !== null, 'speechSynthesis.speak should be called')
    assert.equal(spoken?.text, 'hello', 'utterance.text should match input')
  })

  it('TC-VOICE-PROFILE-1: applies VOICE_PROFILES pitch/rate for each character', () => {
    const characters = ['walter', 'jesse', 'skyler', 'saul', 'mike', 'gus'] as const
    for (const characterId of characters) {
      let spoken: { pitch?: number; rate?: number } | null = null
      const synth = {
        speak: (u: { pitch?: number; rate?: number }) => {
          spoken = u
        },
        getVoices: () => [],
        cancel: () => {},
      }
      const play = createPlayHandler('hi', characterId, 'en', synth)
      play()
      const expected = VOICE_PROFILES[characterId]
      assert.ok(spoken !== null, `${characterId}: speak should be called`)
      assert.equal(
        spoken?.pitch,
        expected.pitch,
        `${characterId}: pitch should be ${expected.pitch}, got ${spoken?.pitch}`
      )
      assert.equal(
        spoken?.rate,
        expected.rate,
        `${characterId}: rate should be ${expected.rate}, got ${spoken?.rate}`
      )
    }
  })

  it('TC-VOICE-PROFILE-2: walter pitch differs from jesse pitch (distinct voices)', () => {
    const results: Record<string, { pitch: number; rate: number }> = {}
    for (const characterId of ['walter', 'jesse'] as const) {
      let spoken: { pitch?: number; rate?: number } | null = null
      const synth = {
        speak: (u: { pitch?: number; rate?: number }) => {
          spoken = u
        },
        getVoices: () => [],
        cancel: () => {},
      }
      createPlayHandler('hi', characterId, 'en', synth)()
      results[characterId] = {
        pitch: spoken!.pitch!,
        rate: spoken!.rate!,
      }
    }
    assert.notEqual(
      results.walter.pitch,
      results.jesse.pitch,
      'walter and jesse should have different pitch values'
    )
    assert.ok(
      results.walter.pitch < results.jesse.pitch,
      'walter (老男) should have lower pitch than jesse (年轻)'
    )
    assert.ok(
      results.walter.rate < results.jesse.rate,
      'walter should have slower rate than jesse (急促)'
    )
  })
})

describe('handleVoiceToggle (play/stop toggle)', () => {
  it('TC-VOICE-TOGGLE-1: speaking state → calls synth.cancel and transitions to idle', () => {
    let cancelled = false
    let stateChange: string | null = null
    const synth = {
      speak: () => {},
      getVoices: () => [],
      cancel: () => { cancelled = true },
    }
    let playCalled = false
    const play = () => { playCalled = true }

    handleVoiceToggle(
      'speaking',
      synth,
      play,
      (s) => { stateChange = s }
    )

    assert.ok(cancelled, 'synth.cancel should be called when speaking')
    assert.equal(stateChange, 'idle', 'state should transition to idle')
    assert.ok(!playCalled, 'play should NOT be called when stopping')
  })

  it('TC-VOICE-TOGGLE-2: idle state → calls play and does NOT call cancel', () => {
    let cancelled = false
    let stateChange: string | null = null
    const synth = {
      speak: () => {},
      getVoices: () => [],
      cancel: () => { cancelled = true },
    }
    let playCalled = false
    const play = () => { playCalled = true }

    handleVoiceToggle(
      'idle',
      synth,
      play,
      (s) => { stateChange = s }
    )

    assert.ok(!cancelled, 'synth.cancel should NOT be called when idle')
    assert.ok(playCalled, 'play should be called when idle')
    // state change is delegated to play() → createPlayHandler → onStateChange
    assert.equal(stateChange, null, 'handleVoiceToggle should not set state when playing')
  })

  it('TC-VOICE-TOGGLE-3: speaking → cancel missing on synth → still transitions to idle', () => {
    let stateChange: string | null = null
    const synth = {
      speak: () => {},
      getVoices: () => [],
      // cancel intentionally omitted
    }
    const play = () => {}

    handleVoiceToggle(
      'speaking',
      synth,
      play,
      (s) => { stateChange = s }
    )

    // Should not throw even without cancel
    assert.equal(stateChange, 'idle', 'state should still transition to idle')
  })
})

describe('pickVoice (heuristic by characterId + language)', () => {
  const voices = [
    { name: 'George Male', lang: 'en-US' },
    { name: 'Samantha Female', lang: 'en-US' },
    { name: 'Tina Female', lang: 'zh-CN' },
    { name: 'Li Male', lang: 'zh-CN' },
  ] as unknown as SpeechSynthesisVoice[]

  it('skyler prefers female voice in matching language', () => {
    const v = pickVoice(voices, 'skyler', 'en')
    assert.ok(v, 'expected a voice')
    assert.match(v!.name, /female/i)
  })

  it('walter prefers male voice in matching language', () => {
    const v = pickVoice(voices, 'walter', 'en')
    assert.ok(v, 'expected a voice')
    assert.match(v!.name, /male/i)
  })

  it('returns undefined when voice pool is empty', () => {
    const empty = pickVoice([], 'walter', 'en')
    assert.equal(empty, undefined)
  })

  it('chinese language filters to zh voices', () => {
    const v = pickVoice(voices, 'walter', 'zh')
    assert.ok(v, 'expected a zh voice')
    assert.ok(v!.lang.toLowerCase().startsWith('zh'))
  })
})
