import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { VoicePlayer } from './VoicePlayer.tsx'
import { pickVoice, createPlayHandler } from '../lib/voicePlayerHelpers.ts'

// node 环境无 SpeechSynthesisUtterance / speechSynthesis，需 mock
class MockUtterance {
  text: string
  lang = ''
  voice: unknown = null
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
