import type { DistId, FrontId, LabId } from "./balance"

export type Listener = "skyler" | "hank"
export type Topic = "whereabouts" | "money" | "jesse"

export type ActionId =
  | "cook"
  | "sell"
  | "buyPrecursor"
  | "launderSaul"
  | "launderCarwash"
  | "buyCarwash"
  | "family"
  | "payJesse"
  | "layLow"
  | "upgradeDist"
  | "buildSuperlab"

/** Where on the map an action happens, so the renderer can drive there. */
export type PlaceId = "home" | "desert" | "superlab" | "saul" | "carwash" | "pollos" | "dea" | "street"

export type EvidenceKind = "nightsAway" | "bigPurchase" | "cashFound" | "hankRumor" | "jesseSeen"

export interface Evidence {
  id: string
  kind: EvidenceKind
  listener: Listener
  topic: Topic
  week: number
}

export interface Belief {
  value: string
  week: number
  uses: number
}

export interface Question {
  evidenceId: string
  topic: Topic
  prompt: string
}

export interface Encounter {
  listener: Listener
  questions: Question[]
  index: number
  answers: AnswerRecord[]
}

export type Outcome =
  | "accepted"
  | "evasive"
  | "contradiction"
  | "crossContradiction"
  | "implausible"
  | "caught"
  | "confession"

export interface AnswerRecord {
  topic: Topic
  value: string
  said: string
  outcome: Outcome
  delta: number
  reason: string
}

export type EndingId = "retired" | "enough" | "short" | "arrested" | "familyGone" | "jesseFlipped"

export interface Ending {
  id: EndingId
  title: string
  body: string
  won: boolean
}

export interface LogEntry {
  week: number
  kind: "action" | "event" | "night" | "system"
  text: string
  place?: PlaceId
  tone?: "good" | "bad" | "neutral"
}

export interface GameState {
  seed: number
  rng: number
  week: number
  phase: "day" | "night" | "over"
  ap: number

  dirty: number
  clean: number
  product: number
  precursor: number

  heat: number
  suspicion: number
  loyalty: number

  lab: LabId
  dist: DistId
  fronts: FrontId[]
  soldLb: number

  absences: number
  skylerKnows: boolean
  lastHankWeek: number
  /** Dirty cash that bought something visible, which a story must cover. */
  unexplainedSpend: number

  evidence: Evidence[]
  beliefs: Record<Listener, Partial<Record<Topic, Belief>>>
  encounter: Encounter | null
  ending: Ending | null

  log: LogEntry[]
  /** The most recent judged answer, for the night panel. */
  lastAnswer: (AnswerRecord & { listener: Listener }) | null
  commands: number
}

export type Command =
  | { t: "act"; a: ActionId }
  | { t: "endWeek" }
  | { t: "answer"; value: string; said?: string }
  | { t: "retire" }

export interface ActionOption {
  id: ActionId
  label: string
  detail: string
  place: PlaceId
  enabled: boolean
  reason?: string
}
