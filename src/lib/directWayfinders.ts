import type { CharacterId } from '../roleProfiles'

export type DirectWayfinderLanguage = 'zh' | 'en'

/** First-move suggestions for Direct. Scene pressure, not helpdesk prompts. */
const WAYFINDERS: Record<CharacterId, Record<DirectWayfinderLanguage, [string, string, string]>> = {
  walter: {
    zh: ['汉克今晚要来吃饭。', '这件事别让斯凯勒知道。', '你最近瘦了。家里有人问过吗？'],
    en: ['Hank is coming to dinner tonight.', 'Skyler cannot know about this.', 'You have lost weight. Has anyone at home asked?'],
  },
  jesse: {
    zh: ['怀特老师，我有点慌。', '钱还在。你别问在哪。', '你又想让我干什么。'],
    en: ['Mr. White, I am freaking out.', 'The money is still here. Do not ask where.', 'What do you want from me this time.'],
  },
  skyler: {
    zh: ['账对不上。你得给我一个说法。', '孩子们在家。你现在不能进来。', '汉克打电话来了。'],
    en: ['The books do not add up. I need an answer.', 'The kids are home. You cannot come in.', 'Hank just called.'],
  },
  saul: {
    zh: ['我需要一个不会留下名字的办法。', '这事要是上庭，你怎么说。', '报价。别绕。'],
    en: ['I need a way that does not leave a name.', 'If this goes to court, what do you say.', 'Quote me. Do not circle.'],
  },
  mike: {
    zh: ['你已经知道了。我只是来确认。', '谁在跟着我。', '这活我只做一次。'],
    en: ['You already know. I am here to confirm.', 'Someone is following me.', 'I only do this job once.'],
  },
  gus: {
    zh: ['我来谈条件。不是来听客套。', '实验室那边出了岔子。', '你凭什么觉得我会怕。'],
    en: ['I came to talk terms. Not courtesy.', 'Something went wrong at the lab.', 'What makes you think I am afraid.'],
  },
  hank: {
    zh: ['我只是来吃个饭。别审我。', '你最近查的案子，跟家里有关吗。', '沃尔特看起来不对劲。'],
    en: ['I just came to eat. Do not interrogate me.', 'This case you are on — does it touch the family.', 'Walt does not look right.'],
  },
  marie: {
    zh: ['斯凯勒最近不对劲。你看见了吗。', '汉克把工作带回家了。', '别对我撒谎。'],
    en: ['Skyler is not herself. Have you seen it.', 'Hank is bringing the job home.', 'Do not lie to me.'],
  },
}

export function getDirectWayfinders(
  characterId: CharacterId,
  language: DirectWayfinderLanguage,
): [string, string, string] {
  return WAYFINDERS[characterId][language]
}

export function isInspectableThinking(thinking: string | null | undefined): boolean {
  if (!thinking) return false
  const text = thinking.trim()
  if (text.length < 12) return false
  return /\s/.test(text)
}
