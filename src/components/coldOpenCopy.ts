/**
 * coldOpenCopy — all cold-open copy, split out of the component (架构债最小拆分).
 * Pure data + copy types only; zero React. Two audiences:
 *  - ColdOpenLanding.tsx (UI render)
 *  - tests and future tooling that need the seed map without rendering
 * Knowledge track (fresh/fan) copy lives side by side so editors see both.
 */

export type ColdOpenLanguage = 'zh' | 'en'

/** Player's show knowledge, chosen once at the brief screen. Drives all copy density. */
export type KnowledgeTrack = 'fresh' | 'fan'

export type ColdOpenChoiceId = 'find_jesse' | 'clean_scene' | 'call_saul' | 'free'

/** Door “start playing” defaults: in the RV as Walter, no prescribed first move. */
export const DEFAULT_BRIEF_CHARACTER_ID = 'walter'
export const DEFAULT_BRIEF_CHOICE_ID: ColdOpenChoiceId = 'free'

export function briefStartPayload(
  track: KnowledgeTrack,
  language: ColdOpenLanguage,
): { choiceId: ColdOpenChoiceId; characterId: string; storyPrompt: string } {
  return {
    choiceId: DEFAULT_BRIEF_CHOICE_ID,
    characterId: DEFAULT_BRIEF_CHARACTER_ID,
    storyPrompt: COLD_OPEN_PROMPTS[DEFAULT_BRIEF_CHOICE_ID][language][track],
  }
}

/**
 * Cold-open scene copy, per knowledge track. The fresh track assumes ZERO show
 * knowledge: every name and stakes is introduced inline. The fan track stays
 * lean — compressed, allusive, pilot-textured.
 */

export type TrackCopy<T> = Record<KnowledgeTrack, T>

/** Story seed text per cold-open choice; parent may also import this map. */
export const COLD_OPEN_PROMPTS: Record<
  ColdOpenChoiceId,
  Record<ColdOpenLanguage, TrackCopy<string>>
> = {
  find_jesse: {
    en: {
      fresh:
        'New Mexico desert, 2:13 a.m. You are Walter White, a chemistry teacher cooking out of an RV to leave his family money before cancer takes him. Your partner Jesse — a young ex-student who panics fast and means well — just bolted into the dark with half the cash from your first big deal, after swearing he heard sirens. Headlights are climbing the access road. You go after Jesse: he is the only person out here who understands the danger even less than you do.',
      fan: 'New Mexico desert, 2:13 a.m. The RV reeks of ammonia and burnt coffee. The buyer never showed, Jesse heard sirens that were not there, and now he has bolted into the dark with half the cash and every reason to panic. Headlights are climbing the access road. You go after Jesse — he is the only person out here who knows less about the danger than you do.',
    },
    zh: {
      fresh:
        '新墨西哥沙漠，凌晨两点十三分。你是沃尔特·怀特，一个查出肺癌、想在死前给家里留点钱的化学老师。你和一个叫杰西的年轻人搭伙——他曾是你的学生，慌得快、心肠热——在沙漠的房车里做一种别人做不出来的蓝色产品。今晚是第一单大买卖，可他突然嚷着听见警笛，揣着一半的钱冲进了黑地。土路尽头，车灯正在爬坡。你决定追出去：整片沙漠里，只有他比你更不懂自己正在靠近什么。',
      fan: '新墨西哥沙漠，凌晨两点十三分。房车里全是氨水味和烧糊的咖啡。买家没露面，杰西把不存在的警笛当成了真的，揣着一半现金冲进了黑地——他有一万个理由慌。土路尽头，车灯正在爬坡。你决定追出去：整片沙漠里，只有他比你更不懂自己正在靠近什么。',
    },
  },
  clean_scene: {
    en: {
      fresh:
        'New Mexico desert, 2:13 a.m. You are Walter White, a chemistry teacher cooking out of an RV to leave his family money before cancer takes him. Your partner Jesse just bolted into the dark with half the cash, and headlights are climbing the access road — whoever is driving does not care whose fault any of this is. You stay: wipe the glassware, bury every trace of the chemistry, erase every print before that light arrives.',
      fan: 'New Mexico desert, 2:13 a.m. The RV reeks of ammonia and burnt coffee. Jesse is gone into the dark with half the cash, and the headlights climbing the access road do not care who is to blame. You stay: wipe the glassware, bury the chemistry, erase every print and every loose end before whatever is coming up that road arrives.',
    },
    zh: {
      fresh:
        '新墨西哥沙漠，凌晨两点十三分。你是沃尔特·怀特，一个查出肺癌、想在死前给家里留点钱的化学老师。搭档杰西揣着一半的钱冲进了黑地，而土路上正在爬坡的车灯不在乎这是谁的错。你留下：擦掉玻璃器皿，埋掉一切化学痕迹，赶在那束光抵达之前，抹掉每一个指纹和每一处破绽。',
      fan: '新墨西哥沙漠，凌晨两点十三分。房车里全是氨水味和烧糊的咖啡。杰西揣着一半现金冲进了黑地，而土路上正在爬坡的车灯不在乎谁的错。你留下：擦掉玻璃器皿，埋掉一切化学痕迹，赶在那束光抵达之前，抹掉每一个指纹和每一处破绽。',
    },
  },
  call_saul: {
    en: {
      fresh:
        'New Mexico desert, 2:13 a.m. You are Walter White, a chemistry teacher cooking out of an RV to leave his family money before cancer takes him. Your partner Jesse has bolted with half the cash, headlights are climbing the access road, and there is exactly one number in your phone that handles nights like this — a cheap-lawyer type who advertises on bus benches. You dial it, and you start learning what his help really costs.',
      fan: 'New Mexico desert, 2:13 a.m. The RV reeks of ammonia and burnt coffee. Jesse is gone, half the cash is gone, and headlights are climbing the access road. There is exactly one number in your phone that handles nights like this — a lawyer who advertises on bus benches. You dial it, and you start learning what his help really costs.',
    },
    zh: {
      fresh:
        '新墨西哥沙漠，凌晨两点十三分。你是沃尔特·怀特，一个查出肺癌、想在死前给家里留点钱的化学老师。搭档杰西揣着一半的钱冲进了黑地，车灯正在爬坡。你的通讯录里只有一个号码接得住今晚这种事——那种在公交站长椅上打广告的便宜律师。你拨了过去，然后开始明白：他的帮忙，到底什么价。',
      fan: '新墨西哥沙漠，凌晨两点十三分。房车里全是氨水味和烧糊的咖啡。杰西不见了，钱少了一半，车灯正在爬坡。你的通讯录里只有一个号码处理得了今晚这种事——那个在公交车站长椅上打广告的律师。你拨了过去，然后开始明白：他的帮忙，到底什么价。',
    },
  },
  free: {
    en: {
      fresh:
        'New Mexico desert, 2:13 a.m. You are Walter White, a chemistry teacher cooking out of an RV to leave his family money before cancer takes him. Your partner Jesse has bolted into the dark with half the cash and headlights are climbing the access road. Nothing says what you do next.',
      fan: 'New Mexico desert, 2:13 a.m. The RV reeks of ammonia and burnt coffee. Jesse has bolted into the dark with half the cash, headlights are climbing the access road, and nothing says what you do next.',
    },
    zh: {
      fresh:
        '新墨西哥沙漠，凌晨两点十三分。你是沃尔特·怀特，一个查出肺癌、想在死前给家里留点钱的化学老师。搭档杰西揣着一半的钱冲进了黑地，车灯正在爬坡。接下来怎么做，没有规定。',
      fan: '新墨西哥沙漠，凌晨两点十三分。房车里全是氨水味和烧糊的咖啡。杰西冲进了黑地，车灯正在爬坡。接下来怎么做，没有规定。',
    },
  },
}

export const CRISIS_COPY: Record<
  ColdOpenLanguage,
  TrackCopy<{ stamp: string; establish: string; body: string }>
> = {
  en: {
    fresh: {
      stamp: 'New Mexico · 2:13 a.m.',
      establish:
        'You are Walter White — a chemistry teacher with cancer, cooking out of an RV with your partner Jesse to leave his family money. First big deal tonight. You held the lab; he stepped out for air.',
      body: 'Now the air reeks of ammonia. Jesse is gone into the dark with half the cash. Headlights are climbing the access road.',
    },
    fan: {
      stamp: 'New Mexico · 2:13 a.m.',
      establish:
        'Your first big deal with your partner Jesse. You held the lab inside the RV; he stepped out for some air.',
      body: 'Now the air reeks of ammonia. Jesse is gone into the dark with half the cash. Headlights are climbing the access road.',
    },
  },
  zh: {
    fresh: {
      stamp: '新墨西哥 · 凌晨 2:13',
      establish:
        '你是沃尔特·怀特——一个查出癌症的化学老师，正和搭档杰西在房车里做最后一票，想赶在病倒之前给家里留点钱。今晚是第一单大买卖。你在车里守着锅，他说出去透口气。',
      body: '现在，空气里全是刺鼻的化学味。杰西揣着一半的钱，冲进了黑地里。土路尽头，车灯正在爬坡。',
    },
    fan: {
      stamp: '新墨西哥 · 凌晨 2:13',
      establish: '你和搭档杰西的第一场大买卖。你在房车里守着锅，他说出去透口气。',
      body: '空气里是氨水味。杰西揣着一半现金，冲进了黑地里。土路尽头，车灯正在爬坡。',
    },
  },
}

/** Brief screen (phase 0): value line + three play modes. */
export const BRIEF_COPY: Record<
  ColdOpenLanguage,
  {
    title: string
    sub: string
    question: string
    fan: string
    fanHint: string
    fresh: string
    freshHint: string
  }
> = {
  zh: {
    title: '这部剧，由你改写。',
    sub: '阿尔伯克基。这一夜，有人已经在门口等你。',
    question: '你看过《绝命毒师》吗？',
    fan: '看过，直接开始',
    fanHint: '今晚从危机里进。不解释设定。',
    fresh: '没看过，边玩边讲',
    freshHint: '边走边告诉你谁是谁。',
  },
  en: {
    title: 'A show you can rewrite.',
    sub: 'Albuquerque. Someone is already waiting at the door.',
    question: 'Have you seen Breaking Bad?',
    fan: 'Yes — start playing',
    fanHint: 'Straight into the crisis. No lore dump.',
    fresh: 'No — explain as we go',
    freshHint: 'We’ll tell you who is who as it happens.',
  },
}

/**
 * First-run: Saul's bus-bench register, not a designer's briefing.
 * Distilled from his TV ads and the desert closer with Walt/Jesse:
 * put the stranger in trouble, flip it, then close ("sit down" / "put a dollar in").
 * Do not explain the game. Do not say 说明书 / try it / walkthrough.
 */
export const INTRO_COPY: Record<
  ColdOpenLanguage,
  { speaker: string; line: string; cta: string }
> = {
  zh: {
    speaker: '索尔·古德曼',
    line: '他们说你完蛋了，一点办法都没有。\n错了。',
    cta: '进来坐。',
  },
  en: {
    speaker: 'Saul Goodman',
    line: "They told you you're finished. Nothing you can do.\nThey're wrong.",
    cta: 'Sit down.',
  },
}

/** First-class play modes on the door. Knowledge is a follow-up for Story only. */
export const MODE_COPY: Record<
  ColdOpenLanguage,
  {
    question: string
    story: { title: string; hint: string }
    direct: { title: string; hint: string }
    crew: { title: string; hint: string }
    back: string
  }
> = {
  zh: {
    question: '你要怎么进这场戏？',
    story: { title: '剧情', hint: '导演演场面，停下来时由你决定。' },
    direct: { title: '单聊', hint: '和一个角色私下谈。' },
    crew: { title: '群聊', hint: '几个人同时在场，互相顶。' },
    back: '返回三种模式',
  },
  en: {
    question: 'How do you want to play?',
    story: { title: 'Story', hint: 'The scene plays. You decide when it pauses.' },
    direct: { title: 'Direct', hint: 'Talk with one character, one-to-one.' },
    crew: { title: 'Crew', hint: 'Several people in the room, talking over each other.' },
    back: 'Back to play modes',
  },
}

/** Diegetic beat while the session starts — not a SaaS spinner. */
export const ENTERING_COPY: Record<ColdOpenLanguage, { diegetic: string; secondary: string }> = {
  en: {
    diegetic: 'The ammonia is still on your sleeves.',
    secondary: 'Entering…',
  },
  zh: {
    diegetic: '氨水味还粘在你的袖口上。',
    secondary: '进入中…',
  },
}

export const CHOICE_COPY: Record<
  ColdOpenChoiceId,
  Record<ColdOpenLanguage, { label: string; hint: string }>
> = {
  find_jesse: {
    en: { label: 'Find Jesse', hint: 'Beat whatever else is out there to him.' },
    zh: { label: '寻找杰西', hint: '赶在沙漠和车灯之前找到他。' },
  },
  clean_scene: {
    en: { label: 'Clean the scene', hint: 'The glass, the chemistry, the prints.' },
    zh: { label: '清理现场', hint: '玻璃、化学痕迹、指纹——一样别留。' },
  },
  call_saul: {
    en: { label: 'Call Saul', hint: 'The one number that handles nights like this.' },
    zh: { label: '打给索尔', hint: '通讯录里唯一接得住这一夜的号码。' },
  },
  free: {
    en: { label: 'Decide myself…', hint: 'No prescribed move. Only the night.' },
    zh: { label: '自己决定…', hint: '没有规定动作。只有这一夜。' },
  },
}

export const UI_COPY: Record<
  ColdOpenLanguage,
  {
    castTitle: string
    castHint: string
    back: string
    settings: string
    continueAs: string
    chosenPrefix: string
    /** Hint on non-Saul faces when the crisis choice already called Saul. */
    recommended: string
    /** Quiet hint on Saul face when Call Saul was already chosen. */
    saulAlready: string
  }
> = {
  en: {
    castTitle: 'You enter as who?',
    castHint: 'Pick a face for this night.',
    back: 'Back to choices',
    settings: 'Line',
    continueAs: 'Enter as',
    chosenPrefix: 'You chose:',
    recommended: 'Recommended',
    saulAlready: 'Already on the line',
  },
  zh: {
    castTitle: '你以谁的身份进入？',
    castHint: '为这一夜选一张脸。',
    back: '返回选择',
    settings: '线路',
    continueAs: '进入角色',
    chosenPrefix: '你已选：',
    recommended: '推荐',
    saulAlready: '已在线上',
  },
}

import type { CharacterId } from '../roleProfiles'

export type CastMember = {
  id: CharacterId
  name: Record<ColdOpenLanguage, string>
  accent: string
}

/** Compact cast for this cold open — not the full 8-card grid. */
export const COLD_OPEN_CAST: CastMember[] = [
  { id: 'walter', name: { en: 'Walter', zh: '沃尔特' }, accent: '#d7e36f' },
  { id: 'jesse', name: { en: 'Jesse', zh: '杰西' }, accent: '#93d7ff' },
  { id: 'saul', name: { en: 'Saul', zh: '索尔' }, accent: '#f7ce46' },
  { id: 'mike', name: { en: 'Mike', zh: '迈克' }, accent: '#b9c0a5' },
]

export const SHOWCASE_COPY: Record<
  ColdOpenLanguage,
  {
    brandTitle: string
    kicker: string
    title: string
    subtitle: string
    story: {
      badge: string
      chip1: string
      chip2: string
      title: string
      desc: string
      cta: string
    }
    direct: {
      badge: string
      title: string
      desc: string
      cta: string
    }
    crew: {
      badge: string
      faction: string
      allPresent: string
      line1Speaker: string
      line1Text: string
      line2Speaker: string
      line2Text: string
      title: string
      desc: string
      cta: string
    }
    knowledgeDialog: {
      question: string
      fan: string
      fanHint: string
      fresh: string
      freshHint: string
      back: string
    }
  }
> = {
  zh: {
    brandTitle: 'BREAKING BAD · ROLEPLAY',
    kicker: 'ALBUQUERQUE NOIR · 沉浸犯罪剧',
    title: '最好找个好律师',
    subtitle: '或者，把知道秘密的人都摆平',
    story: {
      badge: 'STORY · 互动剧情',
      chip1: '长线危机推演',
      chip2: '致命抉择',
      title: '长线剧情演绎',
      desc: '扮演角色，通过对话和行动推进故事。导演主控全局节奏，在需要决定时等待你的输入。',
      cta: '开始故事',
    },
    direct: {
      badge: 'DIRECT · 角色对话',
      title: '角色深度对话',
      desc: '挑选剧中人物，确定你们的关系。聊生活、试探心事，继续只属于你们的对话。',
      cta: '选择角色对话',
    },
    crew: {
      badge: 'CREW · 群像会谈',
      faction: '谈判现场 · 密室分歧',
      allPresent: '多方在场',
      line1Speaker: '沃尔特 · 控制与逻辑',
      line1Text: '“按规矩做，这是活下来的唯一方式。”',
      line2Speaker: '杰西 · 爆发与反抗',
      line2Text: '“他人不在，规矩倒全摆这儿了？！”',
      title: '群像会谈',
      desc: '和多位角色一起聊天，听他们彼此回应、争论或沉默。群聊记录独立保存。',
      cta: '进入群像会谈',
    },
    knowledgeDialog: {
      question: '你看过《绝命毒师》吗？',
      fan: '看过 · 直入危机',
      fanHint: '直接进入房车险境，不堆设定背景',
      fresh: '没看过 · 随进程解释',
      freshHint: '在情节推进中交代角色与恩怨',
      back: '返回选择模式',
    },
  },
  en: {
    brandTitle: 'BREAKING BAD · ROLEPLAY',
    kicker: 'ALBUQUERQUE NOIR · CRIME DRAMA',
    title: 'Better call a lawyer',
    subtitle: 'Or take care of everyone who knows the secret',
    story: {
      badge: 'STORY · NARRATIVE',
      chip1: 'Crisis Driven',
      chip2: 'Crucial Choices',
      title: 'Cinematic Story Engine',
      desc: 'Step into the scene. The director drives the pacing, pausing when it needs your move.',
      cta: 'Start Story',
    },
    direct: {
      badge: 'DIRECT · DIALOGUE',
      title: 'One-on-One Dialogue',
      desc: 'Pick a character and establish your relationship. Talk about life, test the waters, and return to your private conversation.',
      cta: 'Start Conversation',
    },
    crew: {
      badge: 'CREW · CONFRONTATION',
      faction: 'Negotiation · Internal Split',
      allPresent: 'All Present',
      line1Speaker: 'Walter · Control & Logic',
      line1Text: '"Follow the process. It is the only way we survive this."',
      line2Speaker: 'Jesse · Defiance',
      line2Text: '"He’s not even here, but his rules are all over the place?!"',
      title: 'Crew Standoff',
      desc: 'Talk with several characters as they respond, disagree, or fall quiet. This group conversation has its own history.',
      cta: 'Enter Negotiation',
    },
    knowledgeDialog: {
      question: 'Have you seen Breaking Bad?',
      fan: 'Yes · Straight to crisis',
      fanHint: 'Drop into the RV with zero exposition',
      fresh: 'No · Explain as we go',
      freshHint: 'Characters and stakes introduced inline',
      back: 'Back to modes',
    },
  },
}
