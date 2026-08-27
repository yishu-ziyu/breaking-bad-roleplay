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
        'New Mexico desert, 2:13 a.m. You are Walter White, a chemistry teacher cooking out of an RV to leave his family money before cancer takes him. Your partner Jesse has bolted into the dark with half the cash and headlights are climbing the access road. No script covers what you do next. The night is yours — and so is everything you risk in it.',
      fan: 'New Mexico desert, 2:13 a.m. The RV reeks of ammonia and burnt coffee. Jesse has bolted into the dark with half the cash, headlights are climbing the access road, and no script covers what you do next. The night is yours — and so is everything you risk in it.',
    },
    zh: {
      fresh:
        '新墨西哥沙漠，凌晨两点十三分。你是沃尔特·怀特，一个查出肺癌、想在死前给家里留点钱的化学老师。搭档杰西揣着一半的钱冲进了黑地，车灯正在爬坡，没有任何剧本规定你接下来做什么。这一夜属于你——你押上的一切也是。',
      fan: '新墨西哥沙漠，凌晨两点十三分。房车里全是氨水味和烧糊的咖啡。杰西冲进了黑地，车灯正在爬坡，没有任何剧本规定你接下来做什么。这一夜属于你——你押上的一切也是。',
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

/** Brief screen (phase 0): one value line + one knowledge question. 3 seconds. */
export const BRIEF_COPY: Record<
  ColdOpenLanguage,
  { title: string; sub: string; question: string; fan: string; fresh: string }
> = {
  zh: {
    title: '这部剧，由你改写。',
    sub: '一场 AI 实时演绎的《绝命毒师》平行夜。你的每个决定都会写进接下来的剧情——没有规定动作。',
    question: '你看过《绝命毒师》吗？',
    fan: '看过，直接开始',
    fresh: '没看过，边玩边讲',
  },
  en: {
    title: 'A show you can rewrite.',
    sub: 'A Breaking Bad parallel night, performed live by AI. Every call you make gets written into what happens next — no prescribed moves.',
    question: 'Have you seen Breaking Bad?',
    fan: 'Yes — start playing',
    fresh: 'No — explain as we go',
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
