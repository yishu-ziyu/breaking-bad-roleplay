import "./style.css"
import { BALANCE as B } from "../sim/balance"
import { createGame, currentQuestion, legalActions, replay, step } from "../sim/sim"
import { EVASIVE, LISTENER_NAME, story, storiesFor, TOPIC_LABEL } from "../sim/stories"
import type { ActionId, Command, EvidenceKind, GameState, Listener, PlaceId } from "../sim/types"
import { randomSeed } from "../sim/rng"
import { CANNED, disableAI, getSample, hear, isPermanent, speak } from "../ai/voice"
import { Raster } from "../render/raster"
import { renderScene } from "../render/scene"
import { iso, PLACES, route, VIEW_H, VIEW_W } from "../render/world"

// ---------- state ----------

const SAVE_KEY = "abq-ledger-run"
let seed = 0
let commands: Command[] = []
let game: GameState = createGame(1)
let started = false

type NightStage =
  | { stage: "ask"; draft: string }
  | { stage: "hearing"; said: string; ctl: AbortController }
  | { stage: "confirm"; said: string; story: string; quote: string }
  | { stage: "reply"; text: string; done: boolean; ctl?: AbortController }
let night: NightStage = { stage: "ask", draft: "" }
/** Keep the night on screen after the last answer until the player reads the reply. */
let holdNight = false
let sampleFn: Awaited<ReturnType<typeof getSample>> = null
let aiState: "checking" | "on" | "off" = "checking"
let hovered: PlaceId | null = null

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US")
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ seed, commands })) } catch { /* private window: runs just don't persist */ }
}
function loadSave(): { seed: number; commands: Command[] } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    return typeof v?.seed === "number" && Array.isArray(v.commands) ? v : null
  } catch { return null }
}

function begin(newSeed: number, cmds: Command[] = []) {
  seed = newSeed
  commands = cmds
  game = replay(seed, cmds)
  started = true
  holdNight = false
  night = { stage: "ask", draft: "" }
  car.place = "home"; car.path = []; const a = PLACES.home.anchor; car.x = a[0]; car.y = a[1]
  scene.night = game.phase === "night" ? 1 : 0
  $("overlay").hidden = true
  save()
  renderAll()
}

function dispatch(cmd: Command) {
  const before = game
  game = step(game, cmd)
  if (game === before || game.commands === before.commands) return
  commands.push(cmd)
  save()
  if (cmd.t === "act") {
    const opt = legalActions(before).find(o => o.id === cmd.a)
    if (opt) driveTo(opt.place)
  }
  if (cmd.t === "endWeek") driveTo("home")
  renderAll()
  if (game.phase === "over" && cmd.t !== "answer") showEnding()
}

// ---------- the map ----------

const canvas = $("map") as unknown as HTMLCanvasElement
canvas.width = VIEW_W
canvas.height = VIEW_H
const ctx = canvas.getContext("2d")!
const raster = new Raster(VIEW_W, VIEW_H)
const image = ctx.createImageData(VIEW_W, VIEW_H)
const scene = { night: 0 }
const car = { place: "home" as PlaceId, x: PLACES.home.anchor[0], y: PLACES.home.anchor[1], path: [] as [number, number][] }

function driveTo(place: PlaceId) {
  const from = car.path.length ? car.place : car.place
  const path = route(from, place)
  car.place = place
  if (reducedMotion) { const a = PLACES[place].anchor; car.x = a[0]; car.y = a[1]; car.path = []; return }
  car.path.push(...path.slice(1))
}

const HEIGHT: Record<PlaceId, number> = { home: 11, street: 8, dea: 18, saul: 14, pollos: 22, carwash: 20, superlab: 12, desert: 8 }
const PLACE_LABEL = (p: PlaceId): string => {
  if (p === "carwash") return game.fronts.includes("carwash") ? "A1A 洗车店 · 你的" : "A1A 洗车店 · 待售"
  if (p === "superlab") return game.lab === "superlab" ? "洗衣房 · 地下实验室" : "工业洗衣房"
  if (p === "desert") return game.lab === "rv" ? "房车" : "房车 · 闲置"
  return PLACES[p].name
}

let scale = 2
function layoutCanvas() {
  const stage = $("stage")
  const narrow = innerWidth <= 1000
  const w = stage.clientWidth
  const h = narrow ? Infinity : stage.clientHeight
  let s = Math.min(w / VIEW_W, h / VIEW_H)
  if (s >= 2) s = Math.floor(s)
  scale = Math.max(0.5, s)
  canvas.style.width = `${Math.round(VIEW_W * scale)}px`
  canvas.style.height = `${Math.round(VIEW_H * scale)}px`
  $("labels").classList.toggle("sparse", scale < 1.5)
  renderLabels()
}

function renderLabels() {
  $("labels").innerHTML = (Object.keys(PLACES) as PlaceId[]).map(id => {
    const p = PLACES[id]
    const [x, y] = iso(p.gx + p.w / 2, p.gy + p.d / 2, HEIGHT[id] + 4)
    const cls = hovered === id ? "on" : hovered ? "dim" : ""
    return `<span class="label ${cls}" style="left:${x * scale}px;top:${y * scale}px">${esc(PLACE_LABEL(id))}</span>`
  }).join("")
}

let last = performance.now()
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (!document.hidden) {
    const target = !started ? 0.55 : game.phase === "night" || holdNight ? 1 : game.phase === "over" ? scene.night : 0
    const k = reducedMotion ? 1 : Math.min(1, dt * 1.6)
    scene.night += (target - scene.night) * k
    if (Math.abs(target - scene.night) < 0.002) scene.night = target

    if (car.path.length) {
      const [tx, ty] = car.path[0]
      const dx = tx - car.x, dy = ty - car.y, d = Math.hypot(dx, dy)
      const move = dt * 7
      if (d <= move) { car.x = tx; car.y = ty; car.path.shift() } else { car.x += (dx / d) * move; car.y += (dy / d) * move }
    }

    const enc = game.encounter
    const listener: Listener | null = enc ? enc.listener : holdNight && game.lastAnswer ? game.lastAnswer.listener : null
    renderScene(raster, {
      night: scene.night,
      ownsCarwash: game.fronts.includes("carwash"),
      superlab: game.lab === "superlab",
      cookedThisWeek: game.log.some(l => l.week === game.week && l.kind === "action" && (l.place === "desert" || l.place === "superlab") && l.text.includes("煮")),
      heat: game.heat,
      hankVisiting: listener === "hank",
      skylerWaiting: listener === "skyler",
      car: { x: car.x, y: car.y },
      timeMs: reducedMotion ? 0 : now,
      motion: !reducedMotion,
    })
    image.data.set(raster.data)
    ctx.putImageData(image, 0, 0)
  }
  requestAnimationFrame(frame)
}

// ---------- panels ----------

function renderBar() {
  $("week").innerHTML = started ? `第 <b>${game.week}</b> / ${B.weeks} 周 · ${game.phase === "night" || holdNight ? "夜" : game.phase === "over" ? "终局" : "白天"}` : ""
  const pct = Math.min(100, (game.clean / B.goalClean) * 100)
  $("money").innerHTML = `
    <div class="stat dirty"><span class="v">${money(game.dirty)}</span><span class="k">脏钱</span></div>
    <div class="stat goal"><span class="v">${money(game.clean)} <span style="color:var(--muted)">/ ${money(B.goalClean)}</span></span>
      <span class="k">干净的钱</span><div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`
}

function meter(name: string, value: number, color: string, marks: number[], note: string, hot = false) {
  return `<div class="meter ${hot ? "hot" : ""}">
    <div class="row"><span class="name">${name}</span><span class="num">${Math.round(value)}</span></div>
    <div class="gauge" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value)}" aria-label="${name}">
      <i style="width:${value}%;--c:${color}"></i>${marks.map(m => `<s style="left:${m}%"></s>`).join("")}</div>
    <div class="note">${note}</div></div>`
}

function renderMeters() {
  const lab = B.labs[game.lab], dist = B.dist[game.dist]
  $("meters").innerHTML = `<h2>局势</h2>
    ${meter("热度", game.heat, "var(--heat)", [B.weekly.hankHeat, 50], game.heat >= 50 ? "DEA 的车开始在城里转。到 100 被捕。" : game.heat >= B.weekly.hankHeat ? "汉克开始留意了。到 100 被捕。" : `过 ${B.weekly.hankHeat} 汉克会开始问。到 100 被捕。`, game.heat >= 70)}
    ${game.skylerKnows
      ? `<div class="meter"><div class="row"><span class="name">斯凯勒</span></div><div class="note" style="color:var(--blue)">她知道了。每笔货她扣下 ${B.skylerShare * 100}% 给孩子，洗车店她来管账。</div></div>`
      : meter("斯凯勒的怀疑", game.suspicion, "var(--warn)", [], "到 100 她会带孩子走。", game.suspicion >= 70)}
    ${meter("杰西的忠诚", game.loyalty, "var(--good)", [B.weekly.jesseSpiral.below], game.loyalty < B.weekly.jesseSpiral.below ? "他在失控，会惹出事。到 0 他会开口。" : "低于 25 会失控。到 0 他会开口。", game.loyalty < 30)}
    <div class="inventory">
      <div class="stat"><span class="v">${game.product} 磅</span><span class="k">手上的货</span></div>
      <div class="stat"><span class="v">${game.precursor} 份</span><span class="k">甲胺</span></div>
      <div class="stat"><span class="v">${Math.round(lab.purity * 100)}%</span><span class="k">纯度 · ${esc(lab.name)}</span></div>
      <div class="stat"><span class="v">${dist.maxLb} 磅/次</span><span class="k">${esc(dist.name)}</span></div>
    </div>`
}

const EVIDENCE_NOTE: Record<EvidenceKind, string> = {
  nightsAway: "你好几晚不在家",
  bigPurchase: "家里突然多了一大笔开销",
  cashFound: "她在热水器后面找到了现金",
  hankRumor: "有人看见你的车在沙漠里",
  jesseSeen: "有人看见你和平克曼在一起",
}

function renderLedger() {
  const block = (l: Listener) => {
    const knows = l === "skyler" && game.skylerKnows
    const topics = l === "skyler" ? (["whereabouts", "money", "jesse"] as const) : (["whereabouts", "jesse"] as const)
    const pend = game.evidence.filter(e => e.listener === l)
    const meterNote = l === "skyler" ? (knows ? "同谋" : `怀疑 ${game.suspicion}`) : `热度 ${game.heat}`
    return `<div class="who"><h3>${LISTENER_NAME[l]}以为<span>${meterNote}</span></h3>
      ${knows ? `<div class="knows">她知道一切。</div>` : `<dl class="claims">${topics.map(t => {
        const b = game.beliefs[l][t]
        return `<dt>${TOPIC_LABEL[t]}</dt>${b ? `<dd>${esc(story(b.value)?.label ?? b.value)}${b.uses > 1 ? `<em>×${b.uses}</em>` : ""}</dd>` : `<dd class="none">还没问过</dd>`}`
      }).join("")}</dl>`}
      ${pend.length ? `<ul class="pending">${pend.map(e => `<li>记着：${EVIDENCE_NOTE[e.kind]}${e.week < game.week ? "（拖着没说清）" : ""}</li>`).join("")}</ul>` : ""}
    </div>`
  }
  $("ledger").innerHTML = `<h2>账本</h2>${block("skyler")}${block("hank")}`
}

function renderLog() {
  const items = game.log.slice(-60).reverse()
  $("log").innerHTML = `<h2>记录</h2><ol>${items.map(l => `<li class="${l.kind === "night" ? "night" : l.kind === "system" ? "system" : l.tone ?? ""}"><b>W${l.week}</b>${esc(l.text)}</li>`).join("")}</ol>`
}

function renderDock() {
  const dock = $("dock")
  if (!started) { dock.innerHTML = ""; return }
  if (game.phase === "night" || holdNight) { renderNight(dock); return }
  if (game.phase === "over") { dock.innerHTML = ""; return }
  const opts = legalActions(game)
  const pips = Array.from({ length: B.actionsPerWeek }, (_, i) => `<i class="${i < game.ap ? "full" : ""}"></i>`).join("")
  dock.innerHTML = `<div class="dock-head">
      <div class="ap">${pips}<span>这周还能做 ${game.ap} 件事</span></div>
      <div class="row-btns">
        ${game.clean >= B.goalClean ? `<button class="btn primary" data-cmd="retire">收手</button>` : ""}
        <button class="btn night" data-cmd="endWeek">${game.ap > 0 ? "提前收工，" : ""}天黑了 →</button>
      </div></div>
    <div class="actions">${opts.map(o => `
      <button class="act" data-act="${o.id}" data-place="${o.place}" ${o.enabled && game.ap > 0 ? "" : "disabled"}>
        <strong>${esc(o.label)}</strong><span title="${esc(o.detail)}">${esc(o.detail)}</span>
        ${!o.enabled && o.reason ? `<span class="why">${esc(o.reason)}</span>` : ""}
      </button>`).join("")}</div>`
}

// ---------- night ----------

function speakerOf(): Listener {
  return game.encounter?.listener ?? game.lastAnswer?.listener ?? "skyler"
}

function renderNight(dock: HTMLElement) {
  const q = currentQuestion(game)
  const who = speakerOf()
  const name = LISTENER_NAME[who]
  if (night.stage === "reply") {
    const a = game.lastAnswer!
    const good = a.outcome === "accepted" || a.outcome === "confession"
    const unit = a.listener === "skyler" ? "怀疑" : "热度"
    const delta = a.outcome === "confession" && a.listener === "skyler" ? "她知道了" : a.delta ? `${unit} ${a.delta > 0 ? "+" : ""}${a.delta}` : ""
    dock.innerHTML = `<div class="talk">
      <div class="speaker">${name}</div>
      <div class="line">${esc(night.text) || "……"}</div>
      <div><span class="verdict ${good ? "good" : "bad"}">${esc(a.reason)}${delta ? ` · ${delta}` : ""}</span></div>
      <div class="row-btns"><button class="btn night" data-night="continue" ${night.done ? "" : "disabled"}>${game.phase === "night" ? "下一个问题" : game.phase === "over" ? "……" : "天亮了 →"}</button></div>
    </div>`
    return
  }
  if (!q) { dock.innerHTML = ""; return }
  const stories = storiesFor(q.topic)
  const chips = stories.map(s => `<button class="chip ${s.truth ? "truth" : ""}" data-story="${s.id}">${s.truth ? "说实话：" : ""}${esc(s.label)}</button>`).join("")
    + `<button class="chip" data-story="${EVASIVE}">岔开话题</button>`
  const header = `<div class="speaker">${name}</div><div class="line">${esc(q.prompt)}</div>`
  if (night.stage === "hearing") {
    dock.innerHTML = `<div class="talk">${header}<div class="heard">你说：${esc(night.said)}</div>
      <div class="hint">Claude 在听你这句话属于哪种说法……</div>
      <div class="row-btns"><button class="btn" data-night="stop">停下</button></div></div>`
    return
  }
  if (night.stage === "confirm") {
    const label = night.story === EVASIVE ? "岔开话题（没给具体说法）" : story(night.story)?.label ?? night.story
    dock.innerHTML = `<div class="talk">${header}
      <div class="heard">「${esc(night.quote || night.said)}」<br>这句会记进账本：<b>${esc(label)}</b></div>
      <div class="row-btns"><button class="btn night" data-night="commit">就这么说</button><button class="btn" data-night="redo">换个说法</button></div>
      <div class="hint">听错了？直接选你的意思：</div><div class="chips">${chips}</div></div>`
    return
  }
  const aiNote = aiState === "on"
    ? "用你自己的话回答。Claude 只判断你说的是哪种说法，信不信由账本算。"
    : aiState === "checking" ? "正在连接 Claude……" : "这里连不上 Claude，从现成的说法里选。"
  dock.innerHTML = `<div class="talk">${header}
    ${aiState === "on" ? `<textarea id="said" placeholder="你怎么回答？" aria-label="你的回答">${esc(night.draft)}</textarea>
      <div class="row-btns"><button class="btn night" data-night="send">说出口</button></div>` : ""}
    <div class="hint">${aiNote}</div>
    <div class="chips">${chips}</div></div>`
  const ta = document.getElementById("said") as HTMLTextAreaElement | null
  if (ta) {
    ta.addEventListener("input", () => { if (night.stage === "ask") night.draft = ta.value })
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendSaid() })
  }
}

async function sendSaid() {
  const q = currentQuestion(game)
  if (!q || night.stage !== "ask" || !sampleFn) return
  const said = night.draft.trim()
  if (!said) return
  const ctl = new AbortController()
  night = { stage: "hearing", said, ctl }
  renderDock()
  try {
    const out = await hear(sampleFn, game.encounter!.listener, q, said, ctl.signal)
    if (night.stage !== "hearing") return
    night = { stage: "confirm", said, story: out.story, quote: out.quote }
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (isPermanent(code)) { aiState = "off"; disableAI() }
    night = { stage: "ask", draft: said }
  }
  renderDock()
}

async function commit(value: string, said: string) {
  const q = currentQuestion(game)
  if (!q) return
  const listener = game.encounter!.listener
  dispatch({ t: "answer", value, said })
  if (game.phase !== "night") holdNight = true
  const rec = game.lastAnswer!
  const lines = CANNED[listener][rec.outcome]
  const canned = lines[game.week % lines.length]
  if (sampleFn && aiState === "on") {
    const ctl = new AbortController()
    night = { stage: "reply", text: "", done: false, ctl }
    renderAll()
    try {
      const text = await speak(sampleFn, game, listener, q, rec, t => { if (night.stage === "reply") { night.text = t; renderDock() } }, ctl.signal)
      if (night.stage === "reply") night = { stage: "reply", text, done: true }
    } catch (e) {
      const code = (e as { code?: string })?.code
      if (isPermanent(code)) { aiState = "off"; disableAI() }
      if (night.stage === "reply") night = { stage: "reply", text: canned, done: true }
    }
  } else {
    night = { stage: "reply", text: canned, done: true }
  }
  renderAll()
}

function continueNight() {
  night = { stage: "ask", draft: "" }
  if (game.phase !== "night") holdNight = false
  renderAll()
  if (game.phase === "over") showEnding()
}

// ---------- overlays ----------

function showStart() {
  const saved = loadSave()
  const savedGame = saved ? replay(saved.seed, saved.commands) : null
  const o = $("overlay")
  o.hidden = false
  const s0 = randomSeed()
  o.innerHTML = `<div class="card">
    <h1>ABQ 账本</h1>
    <p class="sub">十六周。七十三万七千。一本对得上的账。</p>
    <ul class="rules">
      <li>白天：煮货、出货、洗钱，每周只能做 ${B.actionsPerWeek} 件事。</li>
      <li>晚上：斯凯勒和汉克会问你问题。你说过的每句话都记在账本上，前后对不上就会出事。</li>
      <li>在 ${B.weeks} 周内攒够 $737,000 干净的钱，别被捕，也别让家散了。</li>
    </ul>
    <p class="hint" id="aiNote">${aiLine()}</p>
    <div class="field"><label for="seedInput">城市种子</label>
      <div class="seed"><input id="seedInput" inputmode="numeric" value="${s0}"><button class="btn" id="reroll" aria-label="换一个种子">换</button></div></div>
    <div class="row-btns">
      <button class="btn primary" id="startBtn">开始</button>
      ${savedGame && savedGame.phase !== "over" ? `<button class="btn" id="resumeBtn">继续第 ${savedGame.week} 周</button>` : ""}
    </div></div>`
  $("reroll").onclick = () => { ($("seedInput") as HTMLInputElement).value = String(randomSeed()) }
  $("startBtn").onclick = () => {
    const v = Number(($("seedInput") as HTMLInputElement).value.replace(/\D/g, ""))
    begin(Number.isFinite(v) && v > 0 ? v : randomSeed())
  }
  const r = document.getElementById("resumeBtn")
  if (r && saved) r.onclick = () => begin(saved.seed, saved.commands)
}

function aiLine() {
  return aiState === "on"
    ? "夜里可以用自己的话回答。Claude 帮你把话对上账本、替对方开口，用的是你自己的 Claude 额度；输赢只由规则算。"
    : aiState === "checking" ? "正在连接 Claude……" : "这里连不上 Claude。夜里改成从现成的说法里选，玩法不变。"
}

function showEnding() {
  const e = game.ending
  if (!e) return
  const o = $("overlay")
  o.hidden = false
  o.innerHTML = `<div class="card end">
    <h1 class="${e.won ? "" : "lost"}">${esc(e.title)}</h1>
    <p>${esc(e.body)}</p>
    <dl>
      <dt>干净的钱</dt><dd>${money(game.clean)}</dd>
      <dt>脏钱</dt><dd>${money(game.dirty)}</dd>
      <dt>撑到</dt><dd>第 ${game.week} 周</dd>
      <dt>热度 / 怀疑 / 忠诚</dt><dd>${Math.round(game.heat)} / ${game.skylerKnows ? "知情" : game.suspicion} / ${game.loyalty}</dd>
      <dt>种子</dt><dd>${seed}</dd>
    </dl>
    <div class="row-btns"><button class="btn primary" id="again">再来一局</button><button class="btn" id="same">同一座城再来</button></div>
  </div>`
  $("again").onclick = () => begin(randomSeed())
  $("same").onclick = () => begin(seed)
}

function renderAll() {
  renderBar(); renderMeters(); renderLedger(); renderLog(); renderDock(); renderLabels()
}

// ---------- events ----------

document.addEventListener("click", e => {
  const t = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null
  if (!t || t.disabled) return
  if (t.dataset.act) dispatch({ t: "act", a: t.dataset.act as ActionId })
  else if (t.dataset.cmd === "endWeek") { night = { stage: "ask", draft: "" }; dispatch({ t: "endWeek" }) }
  else if (t.dataset.cmd === "retire") dispatch({ t: "retire" })
  else if (t.dataset.story) {
    const s = t.dataset.story
    const said = night.stage === "confirm" ? night.said : night.stage === "ask" && night.draft.trim() ? night.draft.trim() : ""
    commit(s, said || (s === EVASIVE ? "" : story(s)?.label ?? ""))
  } else if (t.dataset.night === "send") sendSaid()
  else if (t.dataset.night === "commit" && night.stage === "confirm") commit(night.story, night.said)
  else if (t.dataset.night === "redo" && night.stage === "confirm") { night = { stage: "ask", draft: night.said }; renderDock() }
  else if (t.dataset.night === "stop" && night.stage === "hearing") { const d = night.said; night.ctl.abort(); night = { stage: "ask", draft: d }; renderDock() }
  else if (t.dataset.night === "continue") continueNight()
})

document.addEventListener("pointerover", e => {
  const el = (e.target as HTMLElement).closest("[data-place]") as HTMLElement | null
  const next = (el?.dataset.place as PlaceId) ?? null
  if (next !== hovered) { hovered = next; renderLabels() }
})
document.addEventListener("focusin", e => {
  const el = (e.target as HTMLElement).closest("[data-place]") as HTMLElement | null
  hovered = (el?.dataset.place as PlaceId) ?? null
  renderLabels()
})

new ResizeObserver(layoutCanvas).observe($("stage"))
addEventListener("resize", layoutCanvas)

// ---------- boot ----------

getSample().then(fn => {
  sampleFn = fn
  aiState = fn ? "on" : "off"
  const n = document.getElementById("aiNote")
  if (n) n.textContent = aiLine()
  if (started) renderDock()
})

game = createGame(randomSeed())
scene.night = 0.55
renderAll()
layoutCanvas()
requestAnimationFrame(frame)
showStart()
