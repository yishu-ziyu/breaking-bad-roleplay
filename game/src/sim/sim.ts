import { BALANCE as B, type DistId } from "./balance"
import { roll, seedState } from "./rng"
import { EVASIVE, EVIDENCE, LISTENER_NAME, story, TOPIC_LABEL } from "./stories"
import type {
  ActionId, ActionOption, AnswerRecord, Command, Ending, EndingId, Evidence, EvidenceKind,
  GameState, Listener, LogEntry, Outcome, PlaceId, Question, Topic,
} from "./types"

const DIST_ORDER: DistId[] = ["street", "tuco", "gus"]
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US")

export function createGame(seed: number): GameState {
  const s = B.start
  return {
    seed, rng: seedState(seed), week: 1, phase: "day", ap: B.actionsPerWeek,
    dirty: s.dirty, clean: s.clean, product: s.product, precursor: s.precursor,
    heat: s.heat, suspicion: s.suspicion, loyalty: s.loyalty,
    lab: "rv", dist: "street", fronts: ["saul"], soldLb: 0,
    absences: 0, skylerKnows: false, lastHankWeek: -99, unexplainedSpend: 0,
    evidence: [], beliefs: { skyler: {}, hank: {} }, encounter: null, ending: null,
    log: [{ week: 1, kind: "system", text: "第 1 周。你刚拿到诊断书，还有一辆破房车和一个前学生。目标：$737,000 干净的钱。", tone: "neutral" }],
    lastAnswer: null,
    commands: 0,
  }
}

/** Replays a run from its seed. Saves are just this: seed + commands. */
export function replay(seed: number, commands: Command[]): GameState {
  return commands.reduce(step, createGame(seed))
}

// ---------- actions ----------

function nextDist(s: GameState): DistId | null {
  const i = DIST_ORDER.indexOf(s.dist)
  return DIST_ORDER[i + 1] ?? null
}

/** Small crime costs come out of dirty cash first, then out of the clean pile. */
function canSpend(s: GameState, amount: number) {
  return s.dirty + s.clean >= amount
}
function spend(s: GameState, amount: number) {
  const fromDirty = Math.min(s.dirty, amount)
  s.dirty -= fromDirty
  s.clean -= amount - fromDirty
}

function launderTerms(s: GameState, front: "saul" | "carwash") {
  const f = B.fronts[front]
  if (front === "carwash" && s.skylerKnows) return { cap: f.cap + B.skylerBooks.capBonus, fee: B.skylerBooks.fee }
  return { cap: f.cap, fee: f.fee }
}

export function legalActions(s: GameState): ActionOption[] {
  const lab = B.labs[s.lab]
  const dist = B.dist[s.dist]
  const nd = nextDist(s)
  const saul = launderTerms(s, "saul")
  const wash = launderTerms(s, "carwash")
  const owns = s.fronts.includes("carwash")
  const opts: ActionOption[] = [
    {
      id: "cook", label: "煮一批", place: s.lab === "rv" ? "desert" : "superlab",
      detail: `在${lab.name}，+${lab.batchLb} 磅，纯度 ${Math.round(lab.purity * 100)}%，耗 ${lab.precursorPerBatch} 份原料，一晚不回家`,
      enabled: s.precursor >= lab.precursorPerBatch, reason: "原料不够",
    },
    {
      id: "sell", label: "出货", place: s.dist === "gus" ? "pollos" : "street",
      detail: `通过${dist.name}，最多 ${dist.maxLb} 磅，每磅约 ${money(dist.pricePerLb * lab.purity / 0.92)}，热度 +${dist.heatPerLb}/磅`,
      enabled: s.product > 0, reason: "手上没有货",
    },
    {
      id: "buyPrecursor", label: "弄原料", place: "street",
      detail: `${money(B.precursor.cost)} 换 ${B.precursor.units} 份甲胺（先花脏钱），热度 +${B.precursor.heat}`,
      enabled: canSpend(s, B.precursor.cost), reason: "钱不够",
    },
    {
      id: "launderSaul", label: "找索尔洗钱", place: "saul",
      detail: `最多 ${money(saul.cap)}，抽成 ${Math.round(saul.fee * 100)}%`,
      enabled: s.dirty > 0 && !s.skylerKnows, reason: s.skylerKnows ? "斯凯勒不许你再碰索尔的门路" : "没有脏钱",
    },
    owns
      ? {
          id: "launderCarwash", label: "用洗车店洗钱", place: "carwash",
          detail: `最多 ${money(wash.cap)}，抽成 ${Math.round(wash.fee * 100)}%${s.skylerKnows ? "（斯凯勒管账）" : ""}`,
          enabled: s.dirty > 0, reason: "没有脏钱",
        }
      : {
          id: "buyCarwash", label: "买下洗车店", place: "carwash",
          detail: `${money(B.fronts.carwash.cost)} 脏钱。以后洗得快、抽得少——但斯凯勒会问钱哪来的`,
          enabled: s.dirty >= B.fronts.carwash.cost, reason: `要 ${money(B.fronts.carwash.cost)} 脏钱`,
        },
    {
      id: "family", label: "陪家人", place: "home",
      detail: `斯凯勒的怀疑 ${B.family.suspicion}，抵掉一个不在家的晚上`,
      enabled: true,
    },
    {
      id: "payJesse", label: "给杰西分钱", place: "street",
      detail: `${money(B.payJesse.cost)}（先花脏钱），杰西忠诚 +${B.payJesse.loyalty}`,
      enabled: canSpend(s, B.payJesse.cost), reason: "钱不够",
    },
    {
      id: "layLow", label: "避风头", place: "home",
      detail: `这一步什么都不干，热度 ${B.layLow.heat}`,
      enabled: true,
    },
  ]
  if (nd) {
    const d = B.dist[nd]
    opts.push({
      id: "upgradeDist", label: `搭上${d.name}`, place: nd === "gus" ? "pollos" : "street",
      detail: `每周能出 ${d.maxLb} 磅，每磅 ${money(d.pricePerLb)}，热度 +${d.heatPerLb}/磅${d.violence ? "，但他不稳定" : ""}`,
      enabled: s.soldLb >= d.unlockSoldLb, reason: `累计卖出 ${d.unlockSoldLb} 磅后才会见你（现在 ${s.soldLb}）`,
    })
  }
  if (s.lab === "rv") {
    opts.push({
      id: "buildSuperlab", label: "接受地下实验室", place: "superlab",
      detail: `${B.labs.superlab.name}：一批 ${B.labs.superlab.batchLb} 磅，纯度 99%`,
      enabled: s.dist === "gus", reason: "得先搭上炸鸡店老板",
    })
  }
  return opts
}

function applyAction(s: GameState, a: ActionId): void {
  const opt = legalActions(s).find(o => o.id === a)
  if (!opt || !opt.enabled || s.ap <= 0 || s.phase !== "day") return
  s.ap -= 1
  const log = (text: string, tone: LogEntry["tone"] = "neutral") => s.log.push({ week: s.week, kind: "action", text, place: opt.place, tone })
  const lab = B.labs[s.lab]
  switch (a) {
    case "cook": {
      s.precursor -= lab.precursorPerBatch
      s.product += lab.batchLb
      s.absences += 1
      if (s.lab === "rv") s.loyalty = clamp(s.loyalty + 3)
      log(`在${lab.name}里煮了 ${lab.batchLb} 磅。凌晨才到家。`)
      break
    }
    case "sell": {
      const d = B.dist[s.dist]
      const lb = Math.min(s.product, d.maxLb)
      const gross = Math.round(lb * d.pricePerLb * lab.purity / 0.92)
      const held = s.skylerKnows ? Math.round(gross * B.skylerShare) : 0
      const cash = gross - held
      s.product -= lb
      s.soldLb += lb
      s.dirty += cash
      s.heat = clamp(s.heat + lb * d.heatPerLb)
      log(`通过${d.name}出了 ${lb} 磅，收回 ${money(cash)} 脏钱。${held ? `斯凯勒扣下 ${money(held)} 给孩子。` : ""}`, "good")
      if (d.violence && roll(s) < d.violence) {
        s.heat = clamp(s.heat + B.tucoViolence.heat)
        s.loyalty = clamp(s.loyalty + B.tucoViolence.loyalty)
        s.log.push({ week: s.week, kind: "event", text: "图科当着你们的面把一个手下打得半死。杰西吓坏了，街上也开始有人议论。", place: "street", tone: "bad" })
      }
      break
    }
    case "buyPrecursor":
      spend(s, B.precursor.cost)
      s.precursor += B.precursor.units
      s.heat = clamp(s.heat + B.precursor.heat)
      log(`弄到 ${B.precursor.units} 份甲胺。`)
      break
    case "launderSaul":
    case "launderCarwash": {
      const t = launderTerms(s, a === "launderSaul" ? "saul" : "carwash")
      const amt = Math.min(s.dirty, t.cap)
      const out = Math.round(amt * (1 - t.fee))
      s.dirty -= amt
      s.clean += out
      log(`${money(amt)} 脏钱洗成了 ${money(out)}。`, "good")
      break
    }
    case "buyCarwash":
      s.dirty -= B.fronts.carwash.cost
      s.fronts.push("carwash")
      s.unexplainedSpend += B.fronts.carwash.cost
      log(`索尔帮你买下了 A1A 洗车店。`, "good")
      addEvidence(s, "bigPurchase")
      break
    case "family":
      s.suspicion = clamp(s.suspicion + B.family.suspicion)
      s.absences = Math.max(0, s.absences - 1)
      log(`按时回家吃了晚饭。小沃尔特讲了一整晚他的早餐。`)
      break
    case "payJesse":
      spend(s, B.payJesse.cost)
      s.loyalty = clamp(s.loyalty + B.payJesse.loyalty)
      log(`给杰西塞了 ${money(B.payJesse.cost)}。他数了两遍。`)
      break
    case "layLow":
      s.heat = clamp(s.heat + B.layLow.heat)
      log(`什么也没干。房车停在车库里，你坐在后院看天。`)
      break
    case "upgradeDist": {
      const nd = nextDist(s)!
      s.dist = nd
      log(nd === "gus" ? "炸鸡店老板请你坐下。他说话很慢，也很客气。" : "你把货拍在图科面前，报了价。他笑了。", "good")
      break
    }
    case "buildSuperlab":
      s.lab = "superlab"
      log("工业洗衣房底下，一整间不锈钢实验室。房车可以退休了。", "good")
      break
  }
}

// ---------- evidence & nights ----------

function addEvidence(s: GameState, kind: EvidenceKind): void {
  const spec = EVIDENCE[kind]
  if (spec.listener === "skyler" && s.skylerKnows) return
  if (s.evidence.some(e => e.kind === kind)) return
  s.evidence.push({ id: `${kind}-${s.week}`, kind, listener: spec.listener, topic: spec.topic, week: s.week })
}

function endWeek(s: GameState): void {
  if (s.phase !== "day") return
  const W = B.weekly
  s.heat = clamp(s.heat + W.heatDecay)
  s.loyalty = clamp(s.loyalty + W.loyaltyDrift)
  bump(s, "skyler", W.suspicionDrift)
  if (s.loyalty < W.jesseSpiral.below) {
    s.heat = clamp(s.heat + W.jesseSpiral.heat)
    s.log.push({ week: s.week, kind: "event", text: "杰西又消失了两天。有人看见他在自己的派对上把货随便送人。", place: "street", tone: "bad" })
  }

  // questions that were never answered keep festering
  for (const e of s.evidence) {
    if (e.week < s.week) bump(s, e.listener, W.staleEvidence)
  }

  if (s.absences >= W.absenceThreshold) {
    addEvidence(s, "nightsAway")
    s.absences = 0
  }
  if (s.dirty >= W.cashAtHome && roll(s) < W.cashFoundChance) addEvidence(s, "cashFound")
  if (s.heat >= W.hankHeat && s.week - s.lastHankWeek >= W.hankCooldownWeeks) {
    addEvidence(s, s.soldLb > 0 && roll(s) < 0.5 ? "jesseSeen" : "hankRumor")
    s.lastHankWeek = s.week
  }

  if (checkEnding(s)) return
  const enc = openEncounter(s)
  if (enc) {
    s.encounter = enc
    s.phase = "night"
    s.log.push({ week: s.week, kind: "night", text: `夜里，${LISTENER_NAME[enc.listener]}在等你。`, place: enc.listener === "skyler" ? "home" : "home", tone: "neutral" })
  } else {
    s.log.push({ week: s.week, kind: "night", text: "这一夜很安静。", place: "home", tone: "neutral" })
    advanceWeek(s)
  }
}

function openEncounter(s: GameState): GameState["encounter"] {
  if (s.evidence.length === 0) return null
  const oldest = (l: Listener) => Math.min(...s.evidence.filter(e => e.listener === l).map(e => e.week))
  const listeners = (["skyler", "hank"] as Listener[]).filter(l => s.evidence.some(e => e.listener === l))
  listeners.sort((a, b) => oldest(a) - oldest(b))
  const listener = listeners[0]
  const questions: Question[] = []
  for (const e of s.evidence.filter(e => e.listener === listener).sort((a, b) => a.week - b.week)) {
    if (questions.some(q => q.topic === e.topic)) continue
    if (questions.length >= B.weekly.maxQuestions) break
    const prompts = EVIDENCE[e.kind].prompts
    questions.push({ evidenceId: e.id, topic: e.topic, prompt: prompts[Math.floor(roll(s) * prompts.length)] })
  }
  return { listener, questions, index: 0, answers: [] }
}

function bump(s: GameState, listener: Listener, delta: number): number {
  if (listener === "skyler") {
    if (s.skylerKnows) return 0
    s.suspicion = clamp(s.suspicion + delta)
    return delta
  }
  const d = Math.round(delta * B.outcomes.hankScale)
  s.heat = clamp(s.heat + d)
  return d
}

/** The deterministic heart of the night: judge one claim against the ledger. */
export function judge(s: GameState, listener: Listener, topic: Topic, value: string): { outcome: Outcome; reason: string } {
  const st = story(value)
  if (!st || st.topic !== topic || value === EVASIVE) return { outcome: "evasive", reason: "你没有正面回答" }
  if (st.truth) return { outcome: "confession", reason: "你说了实话" }

  const O = B.outcomes
  const prior = s.beliefs[listener][topic]
  if (prior && prior.value !== value) {
    return { outcome: "contradiction", reason: `上次你跟${LISTENER_NAME[listener]}说的是「${story(prior.value)?.label}」` }
  }
  if (st.onceOnly && prior) return { outcome: "implausible", reason: "同一个借口用第二次就不灵了" }

  const other: Listener = listener === "skyler" ? "hank" : "skyler"
  const otherBelief = s.beliefs[other][topic]
  const otherKnowsTruth = other === "skyler" && s.skylerKnows
  if (otherBelief && otherBelief.value !== value && !otherKnowsTruth && roll(s) < O.gossipChance) {
    return { outcome: "crossContradiction", reason: `玛丽转述了你跟${LISTENER_NAME[other]}说的版本：「${story(otherBelief.value)?.label}」` }
  }

  const why = st.implausible?.(s)
  if (why) return { outcome: "implausible", reason: why }

  const uses = prior?.uses ?? 0
  if (roll(s) < st.checkRisk * (1 + O.repeatRisk * uses)) {
    return { outcome: "caught", reason: `${LISTENER_NAME[listener]}去核实了，对不上` }
  }
  return { outcome: "accepted", reason: "说得过去" }
}

const OUTCOME_LINE: Record<Outcome, string> = {
  accepted: "暂时信了", evasive: "不满意", contradiction: "发现前后矛盾", crossContradiction: "听到了另一个版本",
  implausible: "不信", caught: "当场拆穿", confession: "知道了真相",
}

function answer(s: GameState, value: string, said: string): void {
  const enc = s.encounter
  if (s.phase !== "night" || !enc) return
  const q = enc.questions[enc.index]
  const { outcome, reason } = judge(s, enc.listener, q.topic, value)
  let delta = 0

  if (outcome === "confession") {
    if (enc.listener === "hank") {
      s.lastAnswer = { topic: q.topic, value, said, outcome, delta: 0, reason, listener: "hank" }
      s.log.push({ week: s.week, kind: "night", text: "你对汉克说了实话。他沉默了很久，然后伸手去摸腰间的手铐。", tone: "bad" })
      finish(s, "arrested")
      return
    }
    s.skylerKnows = true
    delta = -s.suspicion
    s.suspicion = 0
    s.evidence = s.evidence.filter(e => e.listener !== "skyler")
    for (const t of ["whereabouts", "money", "jesse"] as Topic[]) {
      const truth = { whereabouts: "lab", money: "drugs", jesse: "partner" }[t]
      s.beliefs.skyler[t] = { value: truth, week: s.week, uses: 1 }
    }
  } else {
    delta = bump(s, enc.listener, B.outcomes[outcome])
    const prior = s.beliefs[enc.listener][q.topic]
    if (outcome !== "evasive") {
      s.beliefs[enc.listener][q.topic] = { value, week: s.week, uses: prior?.value === value ? prior.uses + 1 : 1 }
    }
    // an answered question is closed, even a bad answer
    s.evidence = s.evidence.filter(e => !(e.listener === enc.listener && e.topic === q.topic))
  }

  const rec: AnswerRecord = { topic: q.topic, value, said, outcome, delta, reason }
  enc.answers.push(rec)
  s.lastAnswer = { ...rec, listener: enc.listener }
  const label = story(value)?.label ?? "含糊其辞"
  s.log.push({
    week: s.week, kind: "night",
    text: `${TOPIC_LABEL[q.topic]}？你说「${label}」。${LISTENER_NAME[enc.listener]}${OUTCOME_LINE[outcome]}——${reason}。`,
    tone: outcome === "accepted" || outcome === "confession" ? "good" : "bad",
  })

  if (checkEnding(s)) return
  enc.index += 1
  if (enc.index >= enc.questions.length || (outcome === "confession" && enc.listener === "skyler")) {
    s.encounter = null
    advanceWeek(s)
  }
}

function advanceWeek(s: GameState): void {
  if (s.week >= B.weeks) {
    finish(s, s.clean >= B.goalClean ? "enough" : "short")
    return
  }
  s.week += 1
  s.ap = B.actionsPerWeek
  s.phase = "day"
  s.log.push({ week: s.week, kind: "system", text: `第 ${s.week} 周。`, tone: "neutral" })
}

// ---------- endings ----------

export const ENDINGS: Record<EndingId, Ending> = {
  retired: { id: "retired", title: "收手", body: "你数到了那个数字，然后真的停下了。很少有人做得到。", won: true },
  enough: { id: "enough", title: "够了", body: "十六周。钱是干净的，家还在。你没告诉任何人这是怎么做到的。", won: true },
  short: { id: "short", title: "还差一点", body: "时间到了，账户上的数字还不够。你开始盘算，再干一季。", won: false },
  arrested: { id: "arrested", title: "手铐", body: "热度压不住了。DEA 的车停在你家门口，汉克没有下车。", won: false },
  familyGone: { id: "familyGone", title: "空房子", body: "斯凯勒带着孩子走了。桌上留着一张纸条，只有一行字。", won: false },
  jesseFlipped: { id: "jesseFlipped", title: "搭档", body: "杰西坐在审讯室里，面前一杯凉掉的咖啡。他开口了。", won: false },
}

function finish(s: GameState, id: EndingId): void {
  s.ending = ENDINGS[id]
  s.phase = "over"
  s.encounter = null
  s.log.push({ week: s.week, kind: "system", text: `结局：${ENDINGS[id].title}`, tone: ENDINGS[id].won ? "good" : "bad" })
}

function checkEnding(s: GameState): boolean {
  if (s.heat >= B.limits.heat) finish(s, "arrested")
  else if (!s.skylerKnows && s.suspicion >= B.limits.suspicion) finish(s, "familyGone")
  else if (s.loyalty <= B.limits.loyalty) finish(s, "jesseFlipped")
  return s.phase === "over"
}

// ---------- entry point ----------

export function step(prev: GameState, cmd: Command): GameState {
  if (prev.phase === "over") return prev
  const s: GameState = structuredClone(prev)
  s.commands += 1
  switch (cmd.t) {
    case "act": applyAction(s, cmd.a); checkEnding(s); break
    case "endWeek": endWeek(s); break
    case "answer": answer(s, cmd.value, cmd.said ?? ""); break
    case "retire": if (s.clean >= B.goalClean && s.phase === "day") finish(s, "retired"); break
  }
  return s
}

export function currentQuestion(s: GameState): Question | null {
  return s.encounter ? s.encounter.questions[s.encounter.index] ?? null : null
}

export type { Evidence }
