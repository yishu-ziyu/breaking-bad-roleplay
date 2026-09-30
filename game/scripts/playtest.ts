/**
 * Balance playtest: run scripted players over many seeds and report how runs end.
 *   npx tsx scripts/playtest.ts [runs]
 */
import { BALANCE as B } from "../src/sim/balance"
import { createGame, currentQuestion, legalActions, step } from "../src/sim/sim"
import { storiesFor } from "../src/sim/stories"
import type { ActionId, GameState } from "../src/sim/types"

type Bot = { name: string; pick: (s: GameState, rnd: () => number) => ActionId | "end" | "retire" }

const can = (s: GameState, a: ActionId) => legalActions(s).some(o => o.id === a && o.enabled)

function economy(s: GameState): ActionId | "end" {
  if (can(s, "buildSuperlab")) return "buildSuperlab"
  if (can(s, "upgradeDist")) return "upgradeDist"
  if (can(s, "buyCarwash")) return "buyCarwash"
  if (can(s, "launderCarwash") && s.dirty >= 60_000) return "launderCarwash"
  if (!s.fronts.includes("carwash") && s.dirty > B.fronts.carwash.cost + 40_000 && can(s, "launderSaul")) return "launderSaul"
  if (s.product > 0 && (s.product >= B.dist[s.dist].maxLb || s.precursor < B.labs[s.lab].precursorPerBatch)) return "sell"
  if (can(s, "cook")) return "cook"
  if (can(s, "buyPrecursor")) return "buyPrecursor"
  if (can(s, "sell")) return "sell"
  if (can(s, "launderCarwash")) return "launderCarwash"
  return "end"
}

const bots: Bot[] = [
  { name: "greedy", pick: s => (s.clean >= B.goalClean ? "retire" : economy(s)) },
  {
    name: "careful",
    pick: s => {
      if (s.clean >= B.goalClean) return "retire"
      if (s.heat >= 70) return "layLow"
      if (s.suspicion >= 60) return "family"
      if (s.loyalty <= 35 && can(s, "payJesse")) return "payJesse"
      return economy(s)
    },
  },
  {
    name: "confess",
    pick: s => {
      if (s.clean >= B.goalClean) return "retire"
      if (s.heat >= 70) return "layLow"
      if (s.loyalty <= 35 && can(s, "payJesse")) return "payJesse"
      return economy(s)
    },
  },
  {
    name: "random",
    pick: (s, rnd) => {
      const opts = legalActions(s).filter(o => o.enabled)
      if (rnd() < 0.2 || !opts.length) return "end"
      return opts[Math.floor(rnd() * opts.length)].id
    },
  },
]

function answerFor(s: GameState, rnd: () => number, liar: "consistent" | "random" | "confess"): string {
  const q = currentQuestion(s)!
  const l = s.encounter!.listener
  const lies = storiesFor(q.topic).filter(st => !st.truth)
  if (liar === "random") return lies[Math.floor(rnd() * lies.length)].id
  if (liar === "confess" && l === "skyler" && s.suspicion >= 55) return storiesFor(q.topic).find(st => st.truth)!.id
  const prior = s.beliefs[l][q.topic] ?? s.beliefs[l === "skyler" ? "hank" : "skyler"][q.topic]
  if (prior && lies.some(x => x.id === prior.value)) return prior.value
  if (q.topic === "money") return s.fronts.includes("carwash") ? "carwashIncome" : "gambling"
  if (q.topic === "whereabouts") return "tutoring"
  return "student"
}

function run(bot: Bot, seed: number) {
  let s = createGame(seed)
  let r = seed
  const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 2 ** 32)
  let guard = 0
  while (s.phase !== "over" && guard++ < 2000) {
    if (s.phase === "night") { s = step(s, { t: "answer", value: answerFor(s, rnd, bot.name === "random" ? "random" : bot.name === "confess" ? "confess" : "consistent") }); continue }
    const a = s.ap > 0 ? bot.pick(s, rnd) : "end"
    const before = s.commands
    s = a === "end" ? step(s, { t: "endWeek" }) : a === "retire" ? step(s, { t: "retire" }) : step(s, { t: "act", a })
    if (a !== "end" && s.ap === (before === s.commands ? s.ap : s.ap) && s.phase === "day" && a !== "retire") {
      // illegal pick safety: fall through to ending the week next loop
    }
    if (a === "retire" && s.phase !== "over") s = step(s, { t: "endWeek" })
  }
  return s
}

const runs = Number(process.argv[2] ?? 300)
for (const bot of bots) {
  const endings: Record<string, number> = {}
  let weekSum = 0, cleanSum = 0, peakHeat = 0, peakSusp = 0
  for (let i = 0; i < runs; i++) {
    const s = run(bot, 1000 + i)
    const id = s.ending?.id ?? "stuck"
    endings[id] = (endings[id] ?? 0) + 1
    weekSum += s.week; cleanSum += s.clean; peakHeat += s.heat; peakSusp += s.suspicion
  }
  const pct = (n: number) => ((100 * n) / runs).toFixed(0) + "%"
  console.log(
    bot.name.padEnd(8),
    Object.entries(endings).map(([k, v]) => `${k} ${pct(v)}`).join("  "),
    `| avg week ${(weekSum / runs).toFixed(1)}  avg clean $${Math.round(cleanSum / runs / 1000)}k  end heat ${(peakHeat / runs).toFixed(0)}  end susp ${(peakSusp / runs).toFixed(0)}`,
  )
}

if (process.env.TRACE) {
  const bot = bots.find(b => b.name === process.env.TRACE)!
  const s = run(bot, 1000)
  for (const l of s.log) console.log(`W${l.week} ${l.text}`)
  console.log(s.heat, s.suspicion, s.loyalty, s.dirty, s.clean, s.soldLb, s.dist, s.lab)
}
