# C3 — Cyberpunk 2077

**URL**: https://www.cyberpunk.net/us/en/
**Screenshot**: `~/Desktop/taste-refs/C3-cyberpunk.png` (cookie banner partially obstructs; recapture if used for diagnostic)
**Captured**: 2026-07-12
**Captured by**: Playwright, viewport 1440x900

## What is right about it

- Strong yellow/black contrast. The page refuses to be subtle about brand.
- Character portrait on the right is lit and composed like a magazine cover, with intentional graphic style choices (red vertical streaks, hard color blocking).
- Three press quotes stacked vertically with year and outlet — fast social proof without testimonials.
- Industrial typography in the brand mark. Reads as a property, not a product.

## Axis it represents

**Commercial maximalism — anti-reference.** This is what bb.yishuziyu.cn should NOT look like. The aggressive color, multi-character crowd shot, and noise-driven layout read as franchise marketing, not story invitation.

## When I would say "this is what I want"

Never for this product. Cited here as a contrast reference — what happens when atmosphere gets replaced with brand saturation.

## Loop 9 role

**Anti-reference — repel direction.** Sub Agents should compare the BB page against this to test whether the project is drifting toward franchise marketing tone. If the gap between BB and C3 is small, the page has been overdesigned and lost the character's voice.

## Capture caveat

Cookie banner partially obscures the hero. For Phase 2 Sub Agent diagnostics, recapture a clean version:

```
playwright navigate https://www.cyberpunk.net/us/en/
playwright click button "Allow all cookies"  (selector from snapshot)
playwright screenshot cyberpunk-clean.png
```