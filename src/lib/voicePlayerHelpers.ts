import type { CharacterId } from '../roleProfiles'

export type PlayState = 'idle' | 'speaking'

export interface SpeechSynthLike {
  speak: (utterance: SpeechSynthesisUtterance) => void
  getVoices: () => SpeechSynthesisVoice[]
  cancel?: () => void
}

const FEMALE_CHARS: ReadonlySet<CharacterId> = new Set<CharacterId>(['skyler'])

const FEMALE_NAME_RE = /female|woman|samantha|victoria|zira|tina|fiona|karen|hui|mei|ting/i
const MALE_NAME_RE = /male|\bman\b|david|daniel|alex|fred|george|james|oliver|thomas|li|wang|zhang|jun/i

/**
 * 每个角色的音色画像（pitch / rate）。
 * - pitch: 0-2，1 为默认；<1 偏低沉，>1 偏尖锐
 * - rate: 0.1-10，1 为默认；<1 偏慢，>1 偏快
 * 数值保持在 Safari 安全区间（0.5-1.5），避免被 clamp 或静默失败。
 */
export const VOICE_PROFILES: Record<CharacterId, { pitch: number; rate: number }> = {
  walter: { pitch: 0.85, rate: 0.95 }, // 沉稳、克制、略拖
  jesse:  { pitch: 1.15, rate: 1.15 }, // 急促、年轻、上扬
  skyler: { pitch: 1.05, rate: 1.0 },  // 女声、中性节奏
  saul:   { pitch: 1.0,  rate: 1.1 },  // 语速偏快、推销感
  mike:   { pitch: 0.75, rate: 0.85 }, // 低沉、缓慢、老练
  gus:    { pitch: 0.8,  rate: 0.8 },  // 极低沉、极慢、压迫感
  hank:   { pitch: 1.05, rate: 1.12 }, // 外放、略快、吵闹忠诚
}

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
    const profile = VOICE_PROFILES[characterId]
    if (profile) {
      utter.pitch = profile.pitch
      utter.rate = profile.rate
    }
    utter.onstart = () => onStateChange?.('speaking')
    utter.onend = () => onStateChange?.('idle')
    utter.onerror = () => onStateChange?.('idle')
    synth.speak(utter)
    onStateChange?.('speaking')
    return utter
  }
}

/**
 * VoicePlayer toggle 行为：speaking 时停止，idle 时播放。
 * 分离为纯函数以便单测。
 */
export function handleVoiceToggle(
  state: PlayState,
  synth: SpeechSynthLike,
  play: () => void,
  onStateChange?: (s: PlayState) => void
): void {
  if (state === 'speaking') {
    synth.cancel?.()
    onStateChange?.('idle')
  } else {
    play()
  }
}
