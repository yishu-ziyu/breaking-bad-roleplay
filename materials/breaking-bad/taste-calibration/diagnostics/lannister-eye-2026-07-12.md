# lannister-eye diagnostic — 2026-07-12

**Target**: `/Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay/materials/breaking-bad/taste-calibration/current-target/bb-local-1440.png`
**Lens**: atmosphere over interface
**Primary reference (C1)**: Disco Elysium
**Neutral reference (C2)**: Detroit: Become Human
**Anti-reference (C3)**: Cyberpunk 2077

## Gap-by-gap bullets

- **Card vs canvas.** BB ships a left-aligned dark card (rounded corners, faint border) sitting on top of a background photo. C1 lets the painting bleed to all four edges with no container at all. Smallest fix: drop the card container, let the headline sit directly on the photo with a left-side gradient scrim only behind the type.
  *Citation*: C1 — the eye enters the painting, not a panel holding the painting.

- **Single CTA framed as a feature.** "1 选择  2 锚定  3 对话" sits above the entry button and reads as a numbered tutorial. C1's two CTAs read as relics, not steps. Smallest fix: replace the three-pill step row with one short poetic sentence in the same serif, then the entry button directly under it.
  *Citation*: C1 — Disco's "BUY NOW / 现已推出" pair is ceremonial, never instructional.

- **Headline weight and voice.** BB mixes two display weights: white "BREAKING BAD" plus yellow "WORLD LINES" in the same condensed sans. C1 sets the title in one weight across one color and lets the badge do the talking. Smallest fix: collapse to one weight and one color, then move "WORLD LINES" into a small subtitle in the C1 serif style.
  *Citation*: C1 — title is one block, not a two-tone logo treatment.

- **Eye lands on the police lights, not on Walter.** The background photo has a man in a hazmat suit, but the brightest, sharpest, most saturated thing in the frame is the red and blue police lights on the right edge. C2 commits one face as the focal point with controlled lighting. Smallest fix: replace the photo with a single Walter close-up where the brightest light is on his face, and desaturate the background to deep amber-black.
  *Citation*: C2 — the eye lands on the eye, because the page refuses to share the focal point with anything else.

- **Background color is generic movie-poster black.** The current backdrop is a stock night scene with neon flares. C1's chaos is painterly teal, rust, and bone — unmistakably its own world, not a photograph. Smallest fix: tint the photo with a single warm-amber cast (no blue, no purple) so the whole frame reads as one mood.
  *Citation*: C1 — Disco refuses photographic realism, the page is painted.

- **The character is far away and small.** Walter is mid-frame, full body, surrounded by negative space he does not own. C2 shows an extreme close-up where the face owns the viewport. Smallest fix: crop the source image so Walter's face and shoulders fill the right 60% of the hero, eye-line roughly on the upper-third rule.
  *Citation*: C2 — Detroit's eye fills the page, leaving no room for the user to be casual.

- **Yellow accent everywhere, equally.** The headline, the accent line, the CTA, the step numbers, and the button border all share the same gold. C1 uses gold only on two small buttons and lets the painting's reds do the rest. Smallest fix: keep yellow only on the CTA button and one short underline, demote the step numbers and accent bar to a muted warm gray.
  *Citation*: C1 — restraint on the accent is what makes it feel ceremonial, not branded.

- **Hero ends at the fold without a breath.** BB's hero is the whole page above the fold; below it begins the SaaS product. C1 extends the painted world into a large immersive block (paintings, captions, awards) before any commerce. Smallest fix: add one full-bleed section under the hero with a single wide film still and a one-line caption, no buttons.
  *Citation*: C1 — Disco treats the below-the-fold as more atmosphere, not features.

## Out-of-scope drift signals

These would require renaming, restructuring, or rebuilding the visual system. Flag for Loop 10, do not attempt as one task.

- **Two-language typography hierarchy.** The page mixes Chinese body text with English display type but has no consistent serif pairing. Choosing a Chinese display face that holds weight at hero scale (and a matching serif for English subheads) is a type-system decision, not a single edit.
- **Page-level information architecture.** Replacing the current feature-grid landing with a Disco-style world-first IA means rethinking what the page is. This is a product-shape decision, not a visual fix.
- **Asset pipeline for character close-ups.** Getting six clean, license-cleared Walter/Jesse/Skyler portraits that read at hero scale and stay consistent in lighting is a sourcing problem, not a CSS change. Flag for a Loop 11 or later asset task.
- **Painterly vs photographic world.** If the user wants the C1 painting aesthetic, the entire art direction shifts from photography to commissioned or AI-painted stills. That is a full art-direction rebuild, not a styling pass.