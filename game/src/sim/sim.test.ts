import { describe, expect, it } from "vitest"
import { BALANCE as B } from "./balance"
import { createGame, currentQuestion, judge, legalActions, replay, step } from "./sim"
import type { Command, GameState } from "./types"

const act = (s: GameState, a: Command & { t: "act" } extends infer C ? C extends { a: infer A } ? A : never : never) => step(s, { t: "act", a })

function nightWith(listener: "skyler" | "hank", topic: "whereabouts" | "money" | "jesse"): GameState {
  const s = createGame(7)
  s.evidence.push({ id: "x", kind: listener === "skyler" ? "nightsAway" : "jesseSeen", listener, topic, week: 1 })
  return step(s, { t: "endWeek" })
}

describe("determinism", () => {
  it("same seed + commands = same state", () => {
    const cmds: Command[] = [
      { t: "act", a: "cook" }, { t: "act", a: "sell" }, { t: "act", a: "cook" }, { t: "endWeek" },
      { t: "answer", value: "tutoring" }, { t: "act", a: "sell" }, { t: "endWeek" },
    ]
    expect(replay(42, cmds)).toEqual(replay(42, cmds))
  })

  it("never mutates the previous state", () => {
    const s = createGame(1)
    const snap = structuredClone(s)
    step(s, { t: "act", a: "cook" })
    expect(s).toEqual(snap)
  })
})

describe("day actions", () => {
  it("cook turns precursor into product and costs a night at home", () => {
    const s = act(createGame(1), "cook")
    expect(s.product).toBe(B.labs.rv.batchLb)
    expect(s.precursor).toBe(B.start.precursor - 1)
    expect(s.absences).toBe(1)
    expect(s.ap).toBe(B.actionsPerWeek - 1)
  })

  it("ignores illegal actions and spent action points", () => {
    let s = createGame(1)
    expect(act(s, "sell").ap).toBe(s.ap) // no product
    s = { ...s, ap: 0 }
    expect(act(s, "cook").product).toBe(0)
  })

  it("buying the car wash leaves a question behind", () => {
    const s = act({ ...createGame(1), dirty: B.fronts.carwash.cost }, "buyCarwash")
    expect(s.fronts).toContain("carwash")
    expect(s.evidence.map(e => e.kind)).toContain("bigPurchase")
  })

  it("distribution upgrades are gated by pounds sold", () => {
    const s = createGame(1)
    expect(legalActions(s).find(o => o.id === "upgradeDist")?.enabled).toBe(false)
    expect(legalActions({ ...s, soldLb: B.dist.tuco.unlockSoldLb }).find(o => o.id === "upgradeDist")?.enabled).toBe(true)
  })
})

describe("the ledger", () => {
  it("a new story with no conflicts is judged on its own", () => {
    const s = nightWith("skyler", "whereabouts")
    expect(currentQuestion(s)?.topic).toBe("whereabouts")
    const { outcome } = judge(structuredClone(s), "skyler", "whereabouts", "fugue")
    expect(outcome).toBe("accepted") // fugue has no check risk
  })

  it("changing your story to the same person is a contradiction", () => {
    const s = nightWith("skyler", "whereabouts")
    s.beliefs.skyler.whereabouts = { value: "tutoring", week: 1, uses: 1 }
    expect(judge(s, "skyler", "whereabouts", "hospital").outcome).toBe("contradiction")
  })

  it("a story that doesn't fit the world is implausible", () => {
    const s = nightWith("skyler", "money")
    expect(judge(s, "skyler", "money", "carwashIncome").outcome).toBe("implausible")
    s.fronts.push("carwash")
    s.rng = 1
    expect(["accepted", "caught"]).toContain(judge(s, "skyler", "money", "carwashIncome").outcome)
  })

  it("different stories to Skyler and Hank can meet through Marie", () => {
    let hits = 0
    for (let seed = 0; seed < 200; seed++) {
      const s = nightWith("hank", "jesse")
      s.rng = seed
      s.beliefs.skyler.jesse = { value: "student", week: 1, uses: 1 }
      if (judge(s, "hank", "jesse", "weedDealer").outcome === "crossContradiction") hits++
    }
    expect(hits / 200).toBeGreaterThan(B.outcomes.gossipChance - 0.15)
    expect(hits / 200).toBeLessThan(B.outcomes.gossipChance + 0.15)
  })

  it("anything off-vocabulary counts as evasive", () => {
    const s = nightWith("skyler", "whereabouts")
    expect(judge(s, "skyler", "whereabouts", "evasive").outcome).toBe("evasive")
    expect(judge(s, "skyler", "whereabouts", "gambling").outcome).toBe("evasive") // wrong topic
  })

  it("an answer closes the question and records the belief", () => {
    let s = nightWith("skyler", "whereabouts")
    s = step(s, { t: "answer", value: "tutoring", said: "我去给学生补课了" })
    expect(s.evidence).toHaveLength(0)
    expect(s.beliefs.skyler.whereabouts?.value).toBe("tutoring")
    expect(s.phase).toBe("day")
    expect(s.week).toBe(2)
  })
})

describe("confessions", () => {
  it("telling Skyler makes her complicit", () => {
    const s = step({ ...nightWith("skyler", "money"), suspicion: 80 }, { t: "answer", value: "drugs" })
    expect(s.skylerKnows).toBe(true)
    expect(s.suspicion).toBe(0)
    expect(legalActions(s).find(o => o.id === "launderSaul")?.enabled).toBe(false)
  })

  it("telling Hank ends the game", () => {
    const s = step(nightWith("hank", "jesse"), { t: "answer", value: "partner" })
    expect(s.ending?.id).toBe("arrested")
  })
})

describe("endings", () => {
  it("heat at the limit is an arrest", () => {
    const s = step({ ...createGame(1), heat: 99, product: 6 }, { t: "act", a: "sell" })
    expect(s.ending?.id).toBe("arrested")
  })

  it("you can only retire once the money is clean", () => {
    expect(step(createGame(1), { t: "retire" }).ending).toBeNull()
    expect(step({ ...createGame(1), clean: B.goalClean }, { t: "retire" }).ending?.id).toBe("retired")
  })

  it("the last week settles the run", () => {
    const s = step({ ...createGame(1), week: B.weeks }, { t: "endWeek" })
    expect(s.ending?.id).toBe("short")
  })
})
