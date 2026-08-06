# Human Feedback — 2026-07-26 (Loop 11.A verdict)

**Source**: the user, viewing the Loop 11.A landing page locally at `http://localhost:5173/` (Vite dev server).
**Method**: the user was asked the Loop 11.A stop-condition question after the typography tokens + film-still row shipped:

> "Worse."

A single word.

## What this feedback is

A direct verdict that the Loop 11.A change set — typography token discipline (Commit 1+2, no behavior change) + full-bleed film-still row (Commit 3) + SOURCES attribution (Commit 4) + fonts self-host staging (Commit 5, deferred) — made the page worse than the Loop 10 baseline.

The user's one-word verdict means: the page as it stands now reads **less like "atmospheric drama product"** than it did before Loop 11.A.

## What this feedback is not

A diagnosis. The user did not point at a specific element and say "this is wrong." They did not call out the SVG plate (`los-pollos.svg`), the deep-amber gradient fade, the saturation/brightness filter (`saturate(0.7) brightness(0.78)`), the aspect ratio (`16 / 6`), the caption copy, the caption position (bottom-right), or any other specific lever.

A prescription. The user did not say "remove the row," "swap the plate," "shrink the row," or "use a different gradient." Just: worse.

## What this proves about the loop

Three things:

1. **The plate was wrong.** `los-pollos.svg` is a cartoon restaurant scene — a stylized fried-chicken bucket on a purple background. The page caption claimed it was "ABQ · desert night, idle engine." The plate did not match the caption. The plate did not match the page tone (warm-amber, atmospheric). The plate did not match any reference set the project has (C1 Disco Elysium is painted noir, C2 Detroit is photo-photoreal, C3 Cyberpunk is industrial). A "restaurant cartoon" was a tonal miss.
2. **The row was heavier than the hero.** A full-bleed 1600×600 plate with its own dark scrim and caption chip added visual mass below the hero. After Loop 10 already added the chat-bubble preview strip + Ken-Burns + vignette pulse, the page already had plenty of breathing room. A second viewport strip pushed it past "atmospheric" into "busy." This was an additive cost that the loop brief flagged as a risk and was unable to mitigate without an actually-right asset.
3. **The brief's own risk model worked.** The brief said: "if no suitable asset exists, ship the layout change with a deep-amber-black gradient placeholder." The gradient placeholder would have been tonally consistent even if plain. Picking a real but tonally wrong plate was the wrong branch of the fallback tree.

## What this does NOT prove

- Typography is fine. Loop 11.A did NOT swap the actual font stack — it only added the discipline gate. The user did not yet get to compare typography. The page they saw had the same fonts as Loop 10 plus a worse plate.
- The token discipline is bad. The TypeScript mirror + the `var(--font-...)` gate are zero-risk additions. They did not contribute to "worse."
- Reverting is the only option. The brief's `better / same / worse` rubric is the contract. `worse` triggers `Loop 11.B'` (full revert + diagnostic reset). That is what is happening now.

## What goes where

- **Revert** all 5 Loop 11.A commits (in progress; see `.ship/loop-11b-prime-decision.md`).
- **Diagnostic baseline reset** — `current-target/` baseline after revert; `gaps.md` gets a new section "Loop 11.A post-mortem" so the next Loop 11.X knows what did NOT work.
- **Re-derive** the Loop 11 visual queue (was: typography + film-still row) once the post-mortem is read. Likely next move: a different plate source (a license-cleared real photo OR an SVG-illustrated ABQ silhouette that actually matches the caption), or a non-row move entirely (e.g. typography swap without the row).

## Where this leaves the rest of the multi-loop plan

Loops 12 (P4 sole-writer), 13 (McKee value-flip gate), 14 (Marie), 15 (Hank TTS), 16 (v1 demo gate) are unaffected. They are backend / correctness / roster / voice work, not visual work. Loop 11.B' is a visual-only revert; the visual queue is paused, the rest of the plan stays in flight.

## Re-plan trigger check

Per the approved FusionPlan re-plan triggers:

> 1. Loop-10 verdict=worse AND root cause not isolated in Loop 11.B'. Visual arc direction is broken.

This was Loop 11.A verdict=worse, not Loop-10. The trigger wording is slightly off — the plan was written assuming the verdict would happen after Loop 10. After Loop 11.A, the same trigger applies if Loop 11.B' cannot isolate the root cause. Today Loop 11.B' can isolate at least one root cause (wrong plate asset). A re-derive of the visual queue is warranted but a full re-plan of the entire multi-loop plan is not.

> 6. Re-calibration shows reference set (C1/C2/C3) biases the verdict — re-derive taste methodology before any further visual loop.

Reference set is not at issue here; the user's verdict is the source of truth.

**Conclusion:** proceed with Loop 11.B' (revert + diagnostic reset), do not trigger a full re-derive. The visual queue (Loop 11.X) will be re-scoped in the post-revert PM intake.