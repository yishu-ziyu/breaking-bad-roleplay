import type { CharacterId } from '../roleProfiles'

export type PlayState = 'idle' | 'speaking' | 'paused'

export interface SpeechSynthLike {
  speak: (utterance: SpeechSynthesisUtterance) => void
  getVoices: () => SpeechSynthesisVoice[]
  cancel?: () => void
}

const FEMALE_CHARS: ReadonlySet<CharacterId> = new Set<CharacterId>(['skyler'])

const FEMALE_NAME_RE = /female|woman|samantha|victoria|zira|tina|fiona|karen|hui|mei|ting/i
const MALE_NAME_RE = /male|\bman\b|david|daniel|alex|fred|george|james|oliver|thomas|li|wang|zhang|jun/i

/**
 * 按 characterId + language 启发式选择声音。
 * - 先按 language 过滤（zh → lang 以 'zh' 开头；en → lang 以 'en' 开头）
 * - skyler 倾向女声；walter/jesse/mike/gus/saul 倾向男声
 * - 无匹配返回 undefined（调用方用系统默认）
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[] | undefined | null,
  characterId: CharacterId,
  language: 'en' | 'zh'
): SpeechSynthesisVoice | undefined {
  if (!voices || voices.length === 0) return undefined
  const langPrefix = language === 'zh' ? 'zh' : 'en'
  const langMatches = voices.filter(v => {
    const lang = (v?.lang || '').toLowerCase()
    return lang.startsWith(langPrefix)
  })
  if (langMatches.length === 0) return undefined

  const wantFemale = FEMALE_CHARS.has(characterId)
  if (wantFemale) {
    return langMatches.find(v => FEMALE_NAME_RE.test(v.name)) ?? langMatches[0]
  }
  return langMatches.find(v => MALE_NAME_RE.test(v.name)) ?? langMatches[0]
}

/**
 * 创建播放 handler。调用时构造 utterance 并交给 speechSynthesis.speak。
 * 返回值供测试断言 utterance 内容。
 */
export function createPlayHandler(
  text: string,
  characterId: CharacterId,
  language: 'en' | 'zh',
  synth: SpeechSynthLike,
  onStateChange?: (s: PlayState) => void
): () => SpeechSynthesisUtterance {
  return () => {
    const voices = synth.getVoices()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = language === 'zh' ? 'zh-CN' : 'en-US'
    const voice = pickVoice(voices, characterId, language)
    if (voice) utter.voice = voice
    utter.onstart = () => onStateChange?.('speaking')
    utter.onend = () => onStateChange?.('idle')
    utter.onerror = () => onStateChange?.('idle')
    synth.speak(utter)
    onStateChange?.('speaking')
    return utter
  }
}
