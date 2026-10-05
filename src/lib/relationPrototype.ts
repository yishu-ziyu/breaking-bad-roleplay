/** Prototype-only relation picker (`?relproto=1`). Not the default product path. */

export type RelationProtoLanguage = 'zh' | 'en'

export function relationPrototypeEnabled(search?: string, hash?: string): boolean {
  const loc = typeof window !== 'undefined'
    ? { search: window.location.search, hash: window.location.hash }
    : { search: '', hash: '' }
  return paramIsOn(search ?? loc.search) || paramIsOn(hash ?? loc.hash)
}

function paramIsOn(segment: string): boolean {
  if (!segment) return false
  const raw = segment.startsWith('?') || segment.startsWith('#') ? segment.slice(1) : segment
  try {
    return new URLSearchParams(raw).get('relproto') === '1'
  } catch {
    return false
  }
}

export const RELATION_EXPLANATIONS: Record<string, Record<RelationProtoLanguage, string>> = {
  'family member': {
    zh: '家里的人。他会把一部分话留在心里。',
    en: 'Family. He will keep some things to himself.',
  },
  'lab partner': {
    zh: '一起干活的搭档。他默认你会跟上。',
    en: 'Lab partner. He expects you to keep up.',
  },
  'former student': {
    zh: '他以前教过你。口气里还带着老师的习惯。',
    en: 'A former student. He still talks like a teacher.',
  },
  'DEA liability': {
    zh: '他怕这件事传到汉克耳朵里。',
    en: 'He worries this could reach Hank.',
  },
  partner: {
    zh: '一起做事的搭档。他说话冲，但会听你的。',
    en: 'Partner. He talks fast, and he will hear you.',
  },
  'old friend': {
    zh: '认识很久的朋友。他会先试探你来干什么。',
    en: 'An old friend. He will test why you came.',
  },
  'dealer contact': {
    zh: '道上认识的人。他不会先把底交给你。',
    en: 'Someone from the street. Trust comes later.',
  },
  'person he disappointed': {
    zh: '被他辜负过的人。他会先觉得亏欠。',
    en: 'Someone he let down. He starts from guilt.',
  },
  spouse: {
    zh: '她的丈夫。她先看你有没有把家里的事说圆。',
    en: 'Her husband. She checks whether the home story still holds.',
  },
  neighbor: {
    zh: '住附近的人。他先当这是一次普通的碰面。',
    en: 'A neighbor. He treats this as an ordinary visit.',
  },
  'person hiding something': {
    zh: '有事瞒着她的人。她会听你没说出口的那半句。',
    en: 'Someone hiding something from her. She listens for the half you skip.',
  },
  client: {
    zh: '来找他办事的客户。他先问你惹上了什么。',
    en: 'A client. He starts with what you walked into.',
  },
  'business partner': {
    zh: '生意上的伙伴。他会把代价说在前面。',
    en: 'A business partner. He puts the price on the table first.',
  },
  witness: {
    zh: '见过不该见的人。他会先量你值多少风险。',
    en: 'A witness. He measures how much risk you are worth.',
  },
  'problem to solve': {
    zh: '要他摆平的麻烦。他先听你需要哪一种下场。',
    en: 'A problem he has to fix. He asks what ending you want.',
  },
  asset: {
    zh: '他用得上的线人。话少，问你该知道的那部分。',
    en: 'An informant he can use. He asks only what you need to know.',
  },
  employer: {
    zh: '给他派活的人。他等你把任务说清楚。',
    en: 'The person who hires him. He waits for a clear job.',
  },
  'person under protection': {
    zh: '他罩着的人。他先看你有没有把自己暴露出去。',
    en: 'Someone he protects. He checks whether you already exposed yourself.',
  },
  'loose end': {
    zh: '知道太多的人。他说话短，盯着你下一步。',
    en: 'A loose end. He keeps it short and watches your next move.',
  },
  employee: {
    zh: '他手下的员工。礼貌还在，考察也在。',
    en: 'An employee. The courtesy stays; so does the evaluation.',
  },
  supplier: {
    zh: '给他供货的人。他只谈约定好的那部分。',
    en: 'A supplier. He stays inside what was already agreed.',
  },
  guest: {
    zh: '请来的客人。他让你先坐，再听你来意。',
    en: 'A guest. He offers a seat, then asks why you came.',
  },
  'person being evaluated': {
    zh: '他正在考察的人。每句闲话都算进判断里。',
    en: 'Someone he is sizing up. Every aside goes into the judgment.',
  },
  'DEA partner': {
    zh: '局里的搭档。他会拿玩笑先探你一句。',
    en: 'His partner at the office. A joke comes before the real question.',
  },
  'suspect under watch': {
    zh: '他盯上的嫌疑人。客气还在，记录也在。',
    en: 'A suspect he is watching. The manners stay; so does the file.',
  },
  'friend of the family': {
    zh: '家里的朋友。他会把你当自己人，也还是会问。',
    en: 'A friend of the family. He treats you as one of them, and he still asks.',
  },
  'Skyler sister-in-law': {
    zh: '斯凯勒家这边的亲戚。她会把家里的气氛听得很细。',
    en: "Family on Skyler's side. She hears the temperature at home.",
  },
  'Hank spouse': {
    zh: '汉克的另一半。她先关心你过得怎么样。',
    en: "Hank's wife. She starts with how your day is going.",
  },
  'supportive but uncomprehending': {
    zh: '支持她、但不太懂她的人。她会说很多，也等你接住。',
    en: "Someone supportive who doesn't quite get her. She talks, and waits for you to catch it.",
  },
}

export function relationExplanation(option: string, language: RelationProtoLanguage): string {
  return RELATION_EXPLANATIONS[option]?.[language] ?? ''
}

export function relationLockCopy(language: RelationProtoLanguage): string {
  return language === 'zh'
    ? '开聊以后就不能在这里改关系了。认错了，直接在对话里说。'
    : 'This stays set after the first message. If it is wrong, just say so in the chat.'
}

export function relationPrototypeSelectedWord(language: RelationProtoLanguage): string {
  return language === 'zh' ? '已选' : 'Selected'
}

export function relationPrototypeLabel(language: RelationProtoLanguage): string {
  return language === 'zh' ? '你们的关系' : 'How you know each other'
}
