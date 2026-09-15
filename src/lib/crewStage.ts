import type { CharacterId } from '../roleProfiles'
import { coercePlayableCharacterId } from '../roleProfiles'

export type CrewStageLanguage = 'zh' | 'en'

/** Same pad order as backend `crew_participants_from_message`. */
export const CREW_ROOM_PAD: CharacterId[] = [
  'walter',
  'jesse',
  'saul',
  'skyler',
  'mike',
]

export function defaultCrewIds(primary: CharacterId, cap = 3): CharacterId[] {
  const ids: CharacterId[] = [coercePlayableCharacterId(primary)]
  for (const id of CREW_ROOM_PAD) {
    if (ids.length >= cap) break
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

export function getCrewOpener(language: CrewStageLanguage): string {
  return language === 'zh'
    ? '几个人已经在场。你开口，他们会互相顶。'
    : 'The room is already here. You speak, they talk over each other.'
}

export function getCrewFrame(language: CrewStageLanguage): string {
  return language === 'zh'
    ? '几个人同时在场。顶撞是角色，不是客服。'
    : 'Several people in the room. Pushback is character, not customer service.'
}

export function getCrewPlaceholder(language: CrewStageLanguage): string {
  return language === 'zh' ? '对在场的人说…' : 'Speak to the room…'
}

/** Room-directed first moves. Naming people also pulls them into the debate. */
export function getCrewWayfinders(
  language: CrewStageLanguage,
): [string, string, string] {
  if (language === 'zh') {
    return [
      '杰西，钱还在你那儿。沃尔特知道吗。',
      '索尔，这事要是上庭你怎么说。',
      '别互相瞒着。汉克今晚可能来。',
    ]
  }
  return [
    'Jesse still has the money. Does Walt know.',
    'Saul, if this goes to court, what do you say.',
    'Stop covering for each other. Hank might come tonight.',
  ]
}
