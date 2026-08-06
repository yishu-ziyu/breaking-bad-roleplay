# gaps.md — Three gaps to close before next ship

**Compiled**: 2026-07-12
**Source diagnostics**: lannister-eye, kid-30-second, studio-buyer (all 2026-07-12)
**Diagnostic target**: local dev server `localhost:5174`, latest code (NOT the public site `bb.yishuziyu.cn`, which is behind several loops)
**Reference set**: C1 Disco Elysium (primary), C2 Detroit: Become Human (neutral), C3 Cyberpunk 2077 (anti-reference)

Three Sub Agents ran in parallel with three different lenses. They converged on the same three problems from different angles. The convergence is the signal.

---

## Gap 1 — The hero has no focal point. The eye does not know where to land.

### Evidence

- **lannister-eye**: "The background photo has a man in a hazmat suit, but the brightest, sharpest, most saturated thing in the frame is the red and blue police lights on the right edge."
- **lannister-eye**: "Walter is mid-frame, full body, surrounded by negative space he does not own."
- **kid-30-second**: "The hero splits the viewport in half — title left, man right, no connective tissue. BB reads like a slide deck."
- **studio-buyer**: "There is no face a buyer can cast against. C1 and C2 both commit to a single figure you cannot look away from; BB treats its protagonist like scenery."

### What we have

A left-aligned title card (rounded corners, dark plate, thin yellow rule) on the left half, a full-body man in a hazmat suit standing mid-distance on the right half, and a police-light flare at the far right edge. Three competing focal points, none dominant. The title and the figure never meet visually.

### What the references have

- **C1 Disco Elysium**: the painting bleeds to all four edges with no container; the eye enters the world, not a panel.
- **C2 Detroit: Become Human**: one character eye fills the right half of the viewport. There is exactly one focal point. The page refuses to share attention with anything else.

### Smallest fix

Replace the standing mid-distance figure with a tight 3/4 crop of one face (Walter or whichever character is the lead). The face occupies the right 50-60% of the hero. Eye-line on the upper-third rule. Background desaturated to deep amber-black so the face is the brightest object on the page. Drop the rounded-corner card container — let the title sit directly on the photo with a left-side gradient scrim only behind the type.

### Loop 10 task

**YES.** Single biggest leverage. Frontend-only change. Touches `src/App.tsx` and `src/App.css` (or whichever components own the landing hero). No backend impact. Probably 1-3 hours of focused work once a hero portrait asset is sourced.

---

## Gap 2 — The page says nothing about characters until the user clicks.

### Evidence

- **kid-30-second**: "By 10 seconds the user still does not know whether this is a quiz, a chatbot, a game, or a story. The page is about specific people and none of them is named."
- **kid-30-second**: "No character line of dialogue, no quote, no moment that earns a second look."
- **studio-buyer**: "The three-step indicator ('选择 / 锚定 / 对话') looks like a form wizard, not a story hook."
- **lannister-eye**: "C1 names the protagonist on the page. C2 names Connor on the page. BB names nobody on the page."

### What we have

A three-pill step row: "1 选择 > 2 锚定 > 3 对话". The pills use abstract verbs in dark rounded containers with yellow numerals. They read as a SaaS onboarding tooltip. The single CTA below them says "进入世界" (Enter the World) — a vibe, not an instruction. There is no character name, no character line, no character voice anywhere in the first viewport.

### What the references have

- **C1 Disco Elysium**: names the protagonist in the title block. The CTA is a relic, not a tutorial.
- **C2 Detroit**: shows six captioned screenshots, names the lead character on the page, and provides an "AVAILABLE ON" rail as social proof.
- **C3 Cyberpunk**: three press quotes immediately establish that the property is taken seriously by someone other than its makers.

### Smallest fix

Remove the three-pill step row. Replace it with one short line in a contrasting italic serif — either a five-word line of character dialogue ("*I am the one who knocks*") or a single sentence in the page's subtitle voice. Render the line in 28-32px italic serif above the CTA. Change the CTA copy from "进入世界" to "和 Walter 聊聊" (Chat with Walter) so the verb names the person, not the place.

### Loop 10 task

**YES.** Frontend-only change. Pure typography and copy edit. Probably 1-2 hours.

---

## Gap 3 — The atmosphere is a wallpaper, not a world. Nothing moves. Nothing breathes.

### Evidence

- **kid-30-second**: "The atmosphere is correct but underfed. The street, the police lights, the RV silhouette in the haze, the sodium yellow — these are right. The problem is that this environment reads as a screenshot, not as a place."
- **kid-30-second**: "At 30 seconds the user leaves because nothing moved."
- **lannister-eye**: "Hero ends at the fold without a breath. BB's hero is the whole page above the fold; below it begins the SaaS product."

### What we have

One frozen photo at 30% opacity behind a black plate. Below the hero begins the character picker and chat interface — the product surfaces. There is no second atmosphere layer below the fold, no parallax drift, no cinematic breath. The page is well-composed but inert.

### What the references have

- **C1 Disco Elysium**: extends the painted world into a large immersive block (paintings, captions, awards) below the fold before any commerce.
- **C2 Detroit**: a six-screenshot grid below the hero shows what the product actually does.

### Smallest fix

Add a 48-60px second viewport strip below the hero containing one full-bleed image (a single wide film still, captioned in small caps) and one small chat-bubble preview tile showing what the user will see after clicking the CTA. Two CSS-only animations: a slow Ken-Burns drift on the hero background (0.3x speed), and a subtle vignette pulse around the title plate.

### Loop 10 task

**PARTIAL.** Frontend-only change for the preview tile and animations. The film-still row requires a real asset (a single wide BB-themed still). Loop 10 can ship the preview tile and the animations without the asset; the asset becomes a Loop 11 task.

---

## Gap 4 — Typography is not yet right.

### Evidence

- **Human feedback (2026-07-12)**: "自己做出来的页面，字体没有很深得我心。"
- None of the three Sub Agents listed typography as a top-three gap. The human did, on first viewing, in a single sentence. This is the value of Phase 3 — the gap the AI does not see, the human does.

### What we have

A display sans-serif for the English title block (BREAKING BAD / WORLD LINES), a default-weight Chinese body face for the subtitle and step pills, and a small-caps style for the CTA. None of these feel chosen; they read as defaults rendered once.

### What the references have

- **C1 Disco Elysium**: a serif headline face with hand-set italic body. Every glyph is intentional.
- **C2 Detroit**: a quiet grotesque that holds its weight but does not call attention to itself.
- **C3 Cyberpunk**: a custom industrial face with letterform intent, not a system font.

### Smallest fix

Decide on **one** display face for the hero headline and **one** secondary face for body and caption. Replace the current fonts. The Chinese display face must hold weight at hero scale; the Latin secondary face must work as caption and CTA. This is a type-system decision, not a single-edit fix — but it must be made before any further visual work so that the next round of dev does not paint over the same default.

### Loop 10 task

**DEFERRED — dedicated typography pass.** Typography cascades: changing the headline face changes the weight of Gap 1's hero fix, changing the body face changes the legibility of Gap 2's character-line fix. Do not fold typography into the Loop 10 hero work. Plan a small focused loop (Loop 11) that picks one display + one body face and replaces them in one commit, then re-runs the Phase 1-3 calibration against the same reference set.

---

## Drift signals flagged but deferred

These notes appeared in one or more diagnostics but are not single-shot gaps. They are flagged here so Loop 10 does not attempt to swallow them.

- **The literal string "BREAKING BAD" as the page title.** Studio-buyer flagged this as an IP-stewardship failure mode — fan-fiction read, not licensing read. Decision needed: rename the brand mark to a device (symbol / roman numeral / a self-coined title), or commit to the fan-project positioning. **Not a Loop 10 dev task. Product-shape decision.**
- **Asset pipeline for character close-ups.** Six clean, license-cleared portraits at hero scale. Not a CSS change. **Loop 11+ sourcing task.**
- **Two-language type system.** Chinese display face at hero scale that holds weight, paired with English subhead serif. **Loop 11+ type-system task.**
- **Public site is behind the local code by several loops.** `bb.yishuziyu.cn` was last deployed before the most recent visual rework. Loop 9 itself caught this. Deploy bundling should happen together with Loop 10 changes, not separately.

---

## Verdict

**PROCEED.**

Four gaps surfaced, three from Sub Agents and one from the user. Three of them are bounded and Loop 10 can address them in order (Gap 1 hero focal point, Gap 2 character voice, Gap 3 atmosphere breathing). The fourth (Gap 4 typography) is deferred to a dedicated pass because type cascades into the other fixes — folding it into Loop 10 hero work would force the wrong decisions under time pressure.

None of the addressed gaps require a product-shape decision. None require backend work. They are all frontend hero work, with one asset dependency (Gap 3 film still) deferred to Loop 11.

If after Loop 10 the user is still not satisfied, the deferred drift signals are the next territory: brand mark, asset pipeline, type system. Those are larger moves that need a separate product decision, not a taste loop.

---

## Loop 11.A post-mortem (2026-07-26) — verdict=worse → full revert

**What shipped:** typography token discipline (Commit 1+2, no behavior change) + full-bleed film-still row below the hero (Commit 3) + SOURCES attribution row (Commit 4) + fonts self-host staging doc (Commit 5, deferred offline).

**Owner verdict:** "worse" on the live `localhost:5173` page.

**Root cause (isolated):** Commit 3's plate asset (`public/backgrounds/los-pollos.svg`) was a tonally wrong choice — a stylized restaurant cartoon (fried-chicken bucket on purple) used under a "ABQ · desert night, idle engine" caption. The plate did not match the caption, the page tone (warm amber, atmospheric), or any of the C1/C2/C3 references (Disco Elysium noir, Detroit photoreal, Cyberpunk industrial). The Loop 11.A brief's risk register explicitly called out this branch ("if no suitable asset exists, ship the layout change with a deep-amber-black gradient placeholder"). The gradient placeholder branch was the correct fallback; we took the wrong branch.

**What did NOT cause the verdict:**
- Typography token discipline (Commit 1+2): zero behavior change, no risk; user did not yet see typography in isolation.
- SOURCES.md attribution (Commit 4): documentation only, no UI impact.
- Fonts self-host staging doc (Commit 5): deferred, never shipped.

**Lesson for the next Loop 11.X:**
- A wrong asset is worse than no asset. The brief's "gradient placeholder" fallback should have been the default, not the safety net.
- Full-bleed plates need to match the page tone (warm-amber noir) or they read as insertion. Cartoon-style plates break the atmosphere immediately.
- Caption copy and plate imagery must cohere. A "desert night, idle engine" caption under a "restaurant cartoon" plate fails on the first 200ms.

**Action:** Loop 11.A artifacts reverted in full (`.ship/loop-11b-prime-decision.md`). Next PM intake will pick a different visual move. Options to evaluate:
- A different plate source (a license-cleared real photo of an ABQ-style desert service road; an SVG-illustrated silhouette that matches the page tone).
- Skip the film-still row entirely and ship the typography discipline gate alone (the gate is zero-risk).
- Pause the visual queue and move to Loop 12 (P4 sole-writer). Visual moves that don't yet have a real asset are speculative.

**Re-derive status:** the multi-loop plan is NOT re-derived. Loop 12-16 are unaffected. Only the Loop 11 visual queue is paused.