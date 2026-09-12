/** Story 场面: place, crisis, who is on stage — before SSE. */

import type { CharacterId } from '../roleProfiles'
import {
  CHOICE_COPY,
  CRISIS_COPY,
  type ColdOpenChoiceId,
  type ColdOpenLanguage,
  type KnowledgeTrack,
} from '../components/coldOpenCopy'

export type SceneFace = {
  id: CharacterId
  name: string
  isYou: boolean
}

export type StorySceneBill = {
  episodeTitle: string
  place: string
  crisis: string
  onStage: SceneFace[]
  startLabel: string
  holdingLabel: string
  onStageLabel: string
  youTag: string
}

const FACE_NAME: Record<CharacterId, Record<ColdOpenLanguage, string>> = {
  walter: { zh: '沃尔特', en: 'Walter' },
  jesse: { zh: '杰西', en: 'Jesse' },
  skyler: { zh: '斯凯勒', en: 'Skyler' },
  saul: { zh: '索尔', en: 'Saul' },
  mike: { zh: '迈克', en: 'Mike' },
  gus: { zh: '古斯', en: 'Gus' },
  hank: { zh: '汉克', en: 'Hank' },
  marie: { zh: '玛丽', en: 'Marie' },
}

const ON_STAGE_BY_CHOICE: Record<ColdOpenChoiceId, CharacterId[]> = {
  find_jesse: ['walter', 'jesse'],
  clean_scene: ['walter'],
  call_saul: ['walter', 'saul'],
  free: ['walter', 'jesse'],
}

const DEFAULT_CHOICE: ColdOpenChoiceId = 'find_jesse'

export function buildStorySceneBill(opts: {
  choiceId: ColdOpenChoiceId | string | null
  characterId: string
  language: ColdOpenLanguage
  knowledgeTrack: KnowledgeTrack | null
}): StorySceneBill {
  const language = opts.language
  const track: KnowledgeTrack = opts.knowledgeTrack ?? 'fan'
  const choice = isChoiceId(opts.choiceId) ? opts.choiceId : DEFAULT_CHOICE
  const playerId = isCharacterId(opts.characterId) ? opts.characterId : 'walter'
  const crisisCopy = CRISIS_COPY[language][track]
  const choiceCopy = CHOICE_COPY[choice][language]
  const present = uniqueFaces([playerId, ...ON_STAGE_BY_CHOICE[choice]])
  const onStage: SceneFace[] = present.map((id) => ({
    id,
    name: FACE_NAME[id][language],
    isYou: id === playerId,
  }))

  return {
    episodeTitle: language === 'zh' ? `这一夜 · ${choiceCopy.label}` : `This night · ${choiceCopy.label}`,
    place: crisisCopy.stamp,
    crisis: `${choiceCopy.hint} ${crisisCopy.body}`.trim(),
    onStage,
    startLabel: language === 'zh' ? '开演' : 'Raise curtain',
    holdingLabel: language === 'zh' ? '开幕中…' : 'The scene is opening…',
    onStageLabel: language === 'zh' ? '在场' : 'On stage',
    youTag: language === 'zh' ? '你' : 'you',
  }
}

export function holdsSceneCurtain(opts: {
  connectionState: string
  curtainRaised: boolean
  hasLiveSession: boolean
}): boolean {
  if (
    opts.hasLiveSession
    && (opts.connectionState === 'streaming'
      || opts.connectionState === 'beat_paused'
      || opts.connectionState === 'complete')
  ) {
    return false
  }
  if (!opts.curtainRaised) {
    return opts.connectionState === 'idle' || opts.connectionState === 'connecting'
  }
  return opts.connectionState === 'connecting'
}

function isChoiceId(value: string | null | undefined): value is ColdOpenChoiceId {
  return value === 'find_jesse' || value === 'clean_scene' || value === 'call_saul' || value === 'free'
}

function isCharacterId(value: string): value is CharacterId {
  return value in FACE_NAME
}

function uniqueFaces(ids: CharacterId[]): CharacterId[] {
  const seen = new Set<CharacterId>()
  const out: CharacterId[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
