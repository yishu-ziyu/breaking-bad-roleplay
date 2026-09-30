import type { EvidenceKind, GameState, Listener, Topic } from "./types"

/**
 * The fixed vocabulary of stories Walt can tell. Free-text answers are mapped
 * onto one of these by the AI layer; the sim only ever sees the id.
 */
export interface Story {
  id: string
  topic: Topic
  label: string
  /** One-line hint for the classifier and the offline answer chips. */
  hint: string
  truth?: boolean
  /** Chance the listener checks it, before repeat penalties. */
  checkRisk: number
  /** Why it can't be true right now, or null when it holds up. */
  implausible?: (s: GameState) => string | null
  onceOnly?: boolean
}

export const STORIES: Story[] = [
  // where do you go at night
  { id: "tutoring", topic: "whereabouts", label: "给学生补课", hint: "说自己在外面给学生补课、辅导", checkRisk: 0.15 },
  { id: "hospital", topic: "whereabouts", label: "去医院做检查", hint: "说是去医院、化疗、做检查、看病", checkRisk: 0.25 },
  { id: "carwashShift", topic: "whereabouts", label: "在洗车店加班", hint: "说自己在洗车店上班、加班、盘账", checkRisk: 0.2 },
  { id: "fugue", topic: "whereabouts", label: "不记得了", hint: "说自己不记得、恍惚、走神、神游", checkRisk: 0, onceOnly: true },
  { id: "lab", topic: "whereabouts", label: "在煮货", hint: "承认自己在做毒品、在实验室、在煮", checkRisk: 0, truth: true },

  // where does the money come from
  { id: "gretchen", topic: "money", label: "格雷琴和埃利奥特资助的", hint: "说是老朋友格雷琴和埃利奥特出钱、资助治疗", checkRisk: 0.45 },
  {
    id: "gambling", topic: "money", label: "算牌赢的", hint: "说是赌博、打牌、算牌、在赌场赢的", checkRisk: 0.1,
    implausible: s => (s.unexplainedSpend + s.clean > 200_000 ? "这么多钱，不是赌桌上能赢出来的" : null),
  },
  {
    id: "carwashIncome", topic: "money", label: "洗车店的收入", hint: "说是洗车店赚的、生意收入", checkRisk: 0.15,
    implausible: s => (s.fronts.includes("carwash") ? null : "你们根本没有洗车店"),
  },
  { id: "drugs", topic: "money", label: "卖毒品赚的", hint: "承认钱来自毒品、卖货", checkRisk: 0, truth: true },

  // who is Jesse Pinkman to you
  { id: "student", topic: "jesse", label: "以前的学生", hint: "说杰西是自己以前教过的学生", checkRisk: 0.1 },
  { id: "weedDealer", topic: "jesse", label: "卖大麻给我的", hint: "说杰西卖大麻给自己", checkRisk: 0.2 },
  { id: "partner", topic: "jesse", label: "一起煮货的搭档", hint: "承认杰西是合伙煮毒品的搭档", checkRisk: 0, truth: true },
]

export const EVASIVE = "evasive"

export function storiesFor(topic: Topic): Story[] {
  return STORIES.filter(s => s.topic === topic)
}

export function story(id: string): Story | undefined {
  return STORIES.find(s => s.id === id)
}

export const TOPIC_LABEL: Record<Topic, string> = {
  whereabouts: "你晚上去哪了",
  money: "钱是哪来的",
  jesse: "杰西是谁",
}

export const LISTENER_NAME: Record<Listener, string> = {
  skyler: "斯凯勒",
  hank: "汉克",
}

/** What the listener actually says when this evidence comes up. */
export const EVIDENCE: Record<EvidenceKind, { listener: Listener; topic: Topic; prompts: string[] }> = {
  nightsAway: {
    listener: "skyler",
    topic: "whereabouts",
    prompts: [
      "这周你又有两个晚上不在家。手机关机。你去哪了，沃尔特？",
      "小沃尔特问我爸爸是不是又去上夜班了。我不知道怎么回答他。你告诉我。",
    ],
  },
  bigPurchase: {
    listener: "skyler",
    topic: "money",
    prompts: [
      "我看到账单了。我们哪来的钱？",
      "你的治疗费、这些新东西……沃尔特，钱是从哪来的？",
    ],
  },
  cashFound: {
    listener: "skyler",
    topic: "money",
    prompts: [
      "我在热水器后面找到一袋现金。一整袋。解释一下。",
    ],
  },
  hankRumor: {
    listener: "hank",
    topic: "whereabouts",
    prompts: [
      "兄弟，我们的人说有辆阿兹特克老在沙漠那边转悠，跟你那辆一个颜色。你最近晚上都干嘛呢？",
    ],
  },
  jesseSeen: {
    listener: "hank",
    topic: "jesse",
    prompts: [
      "说来好笑——有人看见你跟一个叫平克曼的小混混在一块。你怎么认识他的？",
    ],
  },
}
