# Role GIF Coverage Audit

Date: 2026-05-22

## Why This Audit Exists

The first Gus fix was too local. Gus repeating a GIF was not only a Gus problem; it exposed a project-level media-library problem. Every playable role needs the same coverage and review discipline, otherwise the app will feel uneven: one role may appear cinematic while another becomes text-only or repeats one visual forever.

This audit turns that correction into a standing gate.

## Current Runtime Pool

Source: `src/roleAssets.ts`

| Role | Runtime GIF count | Current state | Product risk | Required next action |
| --- | ---: | --- | --- | --- |
| Walter | 7 | Broadest first-pass pool, not visually audited | May contain weak semantic matches or caption conflicts | Run visual audit and assign approved/hold/rejected |
| Jesse | 1 | Undercovered | Immediate repetition in multi-turn chat | Expand to reviewed pool, then apply semantic anchors |
| Skyler | 0 | Missing | Text-only while still playable | Build pool from scratch with clean domestic/family/conflict anchors |
| Saul | 0 | Missing | Text-only while still playable | Build pool from scratch with legal-office/comic-pressure anchors |
| Mike | 1 | Undercovered | Immediate repetition in terse multi-turn scenes | Expand to reviewed pool with restraint/surveillance/threat anchors |
| Gus | 8 | Expanded but partially unapproved | Some candidates have meme text or subtitle overlays | Demote weak candidates, keep only visually clean approved assets |

## Minimum Quality Bar

A role should not be considered media-ready until it has:

- At least 6 approved GIFs for primary characters.
- At least 4 approved GIFs for secondary-but-playable characters.
- No approved asset whose main visual focus is the wrong character.
- No approved asset with large meme text or conflicting subtitle overlays.
- At least 4 distinct semantic anchors, such as `warning`, `evaluation`, `comic_release`, `family_boundary`, `panic`, `restraint`, or `transactional_negotiation`.
- A cooldown-safe pool where three consecutive emotionally similar replies do not force the same URL.

## Role-Specific Expansion Targets

### Walter

Target anchors:

- `controlled_pressure`
- `chemistry_focus`
- `family_rationalization`
- `cornered_panic`
- `desert_standoff`
- `power_shift`

Status: enough candidates for rotation, but not enough visual review evidence.

### Jesse

Target anchors:

- `panic`
- `wounded_pride`
- `volatile_loyalty`
- `comic_panic`
- `moral_alarm`
- `defensive_sarcasm`

Status: one candidate is not acceptable for live roleplay. Jesse needs immediate expansion.

### Skyler

Target anchors:

- `family_boundary`
- `moral_alarm`
- `suspicion`
- `controlled_anger`
- `protective_fear`
- `domestic_pressure`

Status: empty pool. Skyler should remain text-only until clean, character-centered assets are approved.

### Saul

Target anchors:

- `lawyer_salesmanship`
- `comic_release`
- `evasion`
- `transactional_negotiation`
- `panic_under_jokes`
- `office_pressure`

Status: empty pool. Saul needs a pool that supports comic pressure without turning every reply into a meme.

### Mike

Target anchors:

- `quiet_authority`
- `surveillance`
- `restraint`
- `warning`
- `operational_pressure`
- `deadpan_reaction`

Status: one candidate is not acceptable for live roleplay. Mike needs understated, low-text assets.

### Gus

Target anchors:

- `strategic_calm`
- `evaluation`
- `polite_pressure`
- `warning`
- `business_control`
- `silent_threat`

Status: enough count, insufficient review quality. Existing contact sheet already shows several hold/rejected candidates.

## Reflection Gate For Future Work

Before fixing one role-specific media complaint, answer these questions:

1. Does the same issue exist for the other playable roles?
2. Is this a content-count problem, semantic-tag problem, runtime-selection problem, or visual-quality problem?
3. What is the global minimum quality bar?
4. Which roles currently fail that bar?
5. Should the immediate patch be local, or should it update the shared pipeline?

If at least two roles fail the same quality bar, treat it as a system problem.

## Next Implementation Order

1. Add `review_state` and richer visual semantic fields to media records.
2. Add `show_gif` so GIF display is opt-in.
3. Build or audit pools in this priority order: Jesse, Mike, Saul, Skyler, Walter, Gus cleanup.
4. Add a verifier script that fails when playable roles are below minimum approved pool size.
5. Only then tune runtime scoring and cooldown behavior.
