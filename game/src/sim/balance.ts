/**
 * Every tunable number lives here. The sim reads BALANCE and nothing else;
 * the playtest bots (scripts/playtest.ts) are how these get tuned.
 */

export type LabId = "rv" | "superlab"
export type DistId = "street" | "tuco" | "gus"
export type FrontId = "saul" | "carwash"

export const BALANCE = {
  weeks: 16,
  actionsPerWeek: 3,
  goalClean: 737_000,

  start: {
    dirty: 8_000,
    clean: 0,
    product: 0,
    precursor: 2,
    heat: 5,
    suspicion: 10,
    loyalty: 60,
  },

  labs: {
    rv: { name: "沙漠里的房车", batchLb: 6, precursorPerBatch: 1, purity: 0.92 },
    superlab: { name: "洗衣房地下实验室", batchLb: 18, precursorPerBatch: 3, purity: 0.99 },
  } satisfies Record<LabId, { name: string; batchLb: number; precursorPerBatch: number; purity: number }>,

  dist: {
    street: { name: "杰西的街头网络", maxLb: 6, pricePerLb: 5_000, heatPerLb: 2.5, unlockSoldLb: 0, violence: 0 },
    tuco: { name: "图科", maxLb: 14, pricePerLb: 8_000, heatPerLb: 1.5, unlockSoldLb: 12, violence: 0.2 },
    gus: { name: "炸鸡店老板", maxLb: 36, pricePerLb: 10_000, heatPerLb: 0.4, unlockSoldLb: 40, violence: 0 },
  } satisfies Record<DistId, { name: string; maxLb: number; pricePerLb: number; heatPerLb: number; unlockSoldLb: number; violence: number }>,

  fronts: {
    saul: { name: "索尔找的美甲店", cap: 30_000, fee: 0.3, cost: 0 },
    carwash: { name: "A1A 洗车店", cap: 90_000, fee: 0.1, cost: 160_000 },
  } satisfies Record<FrontId, { name: string; cap: number; fee: number; cost: number }>,
  /** Once Skyler runs the books, the car wash gets better. */
  skylerBooks: { capBonus: 50_000, fee: 0.05 },
  /** Knowing costs something: she holds back a share of every sale for the kids, and she won't go near Saul. */
  skylerShare: 0.2,

  precursor: { cost: 12_000, units: 3, heat: 2 },
  family: { suspicion: -12 },
  payJesse: { cost: 15_000, loyalty: 20 },
  layLow: { heat: -12 },
  tucoViolence: { heat: 10, loyalty: -12 },

  weekly: {
    heatDecay: -2,
    loyaltyDrift: -5,
    /** She notices you've changed, week after week, until she knows why. */
    suspicionDrift: 2,
    /** A question nobody answered keeps her up at night. */
    staleEvidence: 6,
    /** Absences needed before Skyler asks where you go. */
    absenceThreshold: 2,
    /** Dirty cash sitting at home this long gets found, sometimes. */
    cashAtHome: 150_000,
    cashFoundChance: 0.35,
    /** Hank starts asking at this heat. */
    hankHeat: 35,
    hankCooldownWeeks: 3,
    jesseSpiral: { below: 25, heat: 8 },
    maxQuestions: 2,
  },

  /** How each kind of answer moves the listener's meter. */
  outcomes: {
    accepted: -6,
    evasive: 10,
    contradiction: 25,
    crossContradiction: 18,
    implausible: 15,
    caught: 25,
    /** Hank's meter is heat; his reactions are scaled by this. */
    hankScale: 0.6,
    gossipChance: 0.5,
    /** Each repeat of the same story makes it riskier to check. */
    repeatRisk: 0.5,
  },

  limits: { heat: 100, suspicion: 100, loyalty: 0 },
} as const

export type Balance = typeof BALANCE
