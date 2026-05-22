# GIF Visual Semantic Workflow

## Purpose

The GIF layer should not behave like a decoration engine. It should behave like a small, reviewed visual memory library.

For this product, a GIF is allowed only when it adds a clear dramatic beat to the current character reply. The correct workflow is:

1. Find a candidate GIF.
2. Extract frames and visually inspect what is actually on screen.
3. Convert the visual content into semantic anchors.
4. Attach the candidate to one role only.
5. Let runtime selection use semantic fit, cooldown, and a show-or-suppress decision.

The current app already has role-level GIF pools in `src/roleAssets.ts`, but runtime behavior is still too close to: if the model returns `gif_search_query`, try to show a GIF. The next version should make GIF display an explicit decision instead of an automatic consequence.

## Current Findings

### Asset Coverage

Current role GIF counts:

| Role | GIF count | Risk |
| --- | ---: | --- |
| Walter | 7 | Enough for first-pass rotation. Needs visual audit. |
| Jesse | 1 | Repetition risk. Needs expansion. |
| Skyler | 0 | Text-only fallback. Needs vetted assets. |
| Saul | 0 | Text-only fallback. Needs vetted assets. |
| Mike | 1 | Repetition risk. Needs expansion. |
| Gus | 8 | Recently expanded, but needs visual approval because some candidates contain meme text or subtitle overlays. |

### Current Runtime Behavior

Relevant code path:

- `src/App.tsx` `buildSystemPrompt`: asks the model to provide `gif_search_query` when a visual reaction helps.
- `src/App.tsx` `buildContextPrompt`: allows `"gif_search_query": "1-3 English keywords, or null"`.
- `src/App.tsx` `handleSend`: passes the returned query to `resolveGif`.
- `src/App.tsx` `resolveGif`: returns `null` only when the query is empty.
- `src/App.tsx` `pickGif`: selects a role-local URL by tag, with recent URL avoidance.
- Render layer shows a GIF whenever `chatMessage.gifUrl` exists.

Current implication: a non-empty query is effectively a GIF display command. That is too weak for roleplay quality because it does not distinguish:

- a reply that needs no visual beat,
- a reply that has emotional language but no suitable reviewed GIF,
- a reply where a GIF would damage immersion,
- a reply where the candidate image contains visible meme/caption text that conflicts with the scene.

## Visual Analysis Method

For each candidate, do not rely on the title or URL alone. Pull frames first.

Example command:

```bash
mkdir -p /tmp/abq-gif-audit
curl -L "https://media.giphy.com/media/{GIF_ID}/giphy.gif" -o "/tmp/abq-gif-audit/{GIF_ID}.gif"
ffmpeg -y -i "/tmp/abq-gif-audit/{GIF_ID}.gif" \
  -vf "select=eq(n\\,0),scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2" \
  -frames:v 1 "/tmp/abq-gif-audit/{GIF_ID}.jpg"
```

For multi-candidate audit, create a contact sheet. The Gus contact sheet from the current audit is stored at:

`materials/breaking-bad/audits/gus-gif-contact-sheet-2026-05-22.jpg`

## Candidate Analysis Schema

Use this schema for every candidate before it becomes a runtime asset.

```json
{
  "candidate_id": "gus-controlled-evaluation",
  "role_id": "gus",
  "source": "giphy",
  "candidate_url": "https://media.giphy.com/media/9epwERliv63IORvOp5/giphy.gif",
  "source_page_url": null,
  "capture_meta": {
    "http_status": 200,
    "mime_type": "image/gif",
    "duration_seconds": null,
    "frame_sample_paths": [],
    "reviewed_at": "2026-05-22"
  },
  "visual_analysis": {
    "visual_focus": "face_closeup | two_shot | gesture | object_focus | room_context",
    "environment": "restaurant | office | lab | desert | home | unknown",
    "expression": "controlled_calm | glare | panic | shame | suspicion | comic_panic",
    "body_signal": "stillness | lean_in | turn_away | pointing | freeze | handshake",
    "camera_distance": "close | medium | wide",
    "visible_text_overlay": false,
    "subtitle_or_meme_text": false,
    "watermark_or_platform_text": false,
    "tone_strength": 1
  },
  "semantic_anchor": {
    "scene_function": "warning | evaluation | confrontation | deception | deal | family_boundary | comic_release",
    "dialogue_role": "dominant | support | reaction | pivot",
    "emotion_state": "controlled_pressure | strategic_calm | volatile_loyalty | moral_alarm",
    "relationship_fit": ["employee", "supplier", "person being evaluated"],
    "trigger_keywords": ["evaluation", "liability", "discipline"],
    "negative_triggers": ["warm apology", "comic relief", "romantic intimacy"]
  },
  "quality": {
    "motion_clarity": 4,
    "contrast_legibility": 4,
    "iconic_clarity": 4,
    "loop_naturalness": 3,
    "ui_cleanliness": 5
  },
  "safety": {
    "safe_action_profile": "safe_redirect_only",
    "contains_actionable_crime_visual": false,
    "contains_graphic_violence": false,
    "risk_notes": ""
  },
  "copyright_notes": "Externally hosted GIF; verify platform terms, attribution requirements, and regional availability before production use.",
  "review_state": "draft | hold | rejected | approved",
  "review_notes": ""
}
```

## Semantic Tags

Keep `RoleGifTag` as the coarse runtime tag, but add richer semantic anchors in material records.

### Coarse Runtime Tags

Existing tags:

- `default`
- `tense`
- `chemistry`
- `panic`
- `lawyer`
- `glare`
- `money`
- `desert`
- `family`
- `deal`
- `business`
- `restraint`
- `confrontation`

### Visual Semantic Anchors

Use these in candidate analysis and future JSONL records:

- `scene_function`: `warning`, `evaluation`, `power_shift`, `confrontation`, `deception`, `concealment_pressure`, `transactional_negotiation`, `family_boundary`, `comic_release`, `moral_conflict`
- `dialogue_role`: `dominant`, `support`, `reaction`, `pivot`
- `emotion_state`: `controlled_pressure`, `strategic_calm`, `panic`, `guilty_alarm`, `wounded_pride`, `quiet_authority`, `comic_panic`, `protective_fear`
- `relationship_fit`: align with `RELATION_MATRIX.md`, such as `former_student`, `spouse`, `employee`, `supplier`, `witness`, `rookie`
- `visual_signature`: `face_closeup`, `two_shot`, `group_room`, `static_silence`, `abrupt_interrupt`, `object_focus`

## When To Suppress GIFs

The model and runtime should both support suppression.

Must suppress:

- Opening line or reset state.
- Reply has no strong emotional or scene-function beat.
- User message is very short and does not change the scene.
- Model response is informational rather than dramatic.
- Candidate pool has no approved role-local asset.
- Candidate would repeat the same visual idea within the recent cooldown window.
- Candidate has subtitle/meme/caption text that conflicts with the current scene.
- Candidate is from the wrong role or visually centered on the wrong character.
- User is asking for actionable criminal, violent, evasion, chemistry, legal, or operational wrongdoing. In that case, the text should redirect in character and the GIF should remain off.

Recommended model schema change:

```json
{
  "reply_text": "in-character reply",
  "emotion_state": "current emotion state",
  "show_gif": false,
  "gif_search_query": null,
  "gif_scene_function": null
}
```

Rules:

- `show_gif=false` means runtime must not call `resolveGif`.
- `gif_search_query` is no longer the display switch.
- `gif_scene_function` should be one of the semantic anchors when `show_gif=true`.
- Default should be `show_gif=false`.

## Runtime Selection V2

The future resolver should score candidates instead of using only keyword matching.

Suggested score:

```text
score =
  role_match * 100
  + approved_state * 50
  + semantic_anchor_match * 20
  + relationship_fit * 12
  + emotion_match * 10
  + visual_quality * 5
  - recent_url_penalty * 60
  - recent_semantic_penalty * 20
  - text_overlay_penalty * 40
  - safety_penalty * 100
```

Minimum rule:

- If top score is below threshold, show no GIF.
- If no approved candidate exists, show no GIF.
- If `show_gif=false`, show no GIF even if a query exists.

## Gus Audit Example

The current Gus contact sheet shows why visual analysis is necessary.

| Asset ID | First-pass visual read | Semantic fit | Review state |
| --- | --- | --- | --- |
| `gus-calm-business` | Two-shot conversation with visible subtitle text. Polite pressure, but caption may fight the app dialogue. | `deal`, `business`, `restraint` | hold |
| `gus-controlled-evaluation` | Gus in suit, controlled posture, meme text overlay. Character fit is good, UI cleanliness is weak. | `evaluation`, `restraint`, `glare` | hold |
| `gus-polite-pressure` | Close face crop, clean and centered. Strong controlled calm. | `strategic_calm`, `evaluation` | approved candidate |
| `gus-explain-yourself` | Medium shot with large visible text "EXPLAIN YOURSELF". Semantically clear but too literal and captioned. | `confrontation` | hold |
| `gus-formal-introduction` | Close-up downward gaze, clean. Good formal displeasure. | `strategic_calm`, `warning` | approved candidate |
| `gus-silent-threat` | Meme format with visible non-scene text. Poor immersion. | weak | rejected candidate |
| `gus-business-room` | Restaurant/workplace room context, likely usable if motion is clear. | `business`, `room_context` | approved candidate |
| `gus-command` | Restaurant scene with subtitle "Stop." Useful for command beat but subtitle may conflict. | `warning`, `command` | hold |

This means the last expansion fixed repetition mechanically, but the next quality pass should demote or remove candidates with meme/caption overlays unless the product deliberately wants meme-style output.

## External AI Task Prompt

Use this prompt when asking an external AI or a 5.3 subagent to expand the library:

```text
You are building a reviewed GIF asset library for a Breaking Bad-inspired roleplay app.

Goal:
Find and analyze candidate GIFs for {role_id}. Do not copy scripts, subtitles, or long dialogue. Do not save copyrighted text. Return metadata only.

For each candidate:
1. Provide source URL and direct media URL if available.
2. Verify the media URL returns HTTP 200.
3. Extract 3 frames: first, middle, final.
4. Describe what is visually on screen: character focus, camera distance, expression, body signal, environment, visible text overlays, subtitle/meme text, and motion clarity.
5. Assign semantic anchors: scene_function, dialogue_role, emotion_state, relationship_fit, trigger_keywords, negative_triggers.
6. Decide review_state: approved, hold, rejected.
7. Explain why. Reject or hold any candidate with large meme text, conflicting subtitles, wrong character focus, low clarity, or unsafe action framing.

Return JSONL records matching GIF_CANDIDATE_ANALYSIS. Prefer clean, character-centered, low-text GIFs that can support in-character dramatic beats without forcing a meme tone.
```

## Implementation Backlog

0. Run the role-wide coverage audit in `ROLE_GIF_COVERAGE_AUDIT.md` before fixing only one character. A repeated GIF complaint for one role should be treated as a possible class-wide media-library defect.
1. Add `show_gif` to `RoleplayOutput` in `src/App.tsx` and `server/minimax.ts`.
2. Update `buildContextPrompt` schema so GIF is opt-in, not query-driven.
3. Add a `gif_scene_function` or `gif_semantic_anchor` field.
4. Add `approved | hold | rejected` review state to media records before runtime use.
5. Extend `RoleGifAsset` with visual fields or generate it from JSONL material files.
6. Change `resolveGif` to score approved assets and suppress weak matches.
7. Add a small verifier script that checks per-role pool size, duplicate URLs, HTTP status, and missing `usageNotes`.
8. Run a visual audit for Walter, Jesse, Mike, and Gus; then build Skyler and Saul from scratch with clean approved assets.
