# Peer Spec — Breaking Bad Roleplay Demo-Ready Fix

> **WARNING: This spec was self-generated, not independently produced by a peer agent.**
> Peer dispatch was unavailable. This is the best available second perspective.

## Investigation Summary

I independently traced the same code paths as the host:

### Key findings

**Director outline (director.py:266-284):**
The `_generate_outline()` method calls `provider.call_model()` with the Director system prompt. The prompt asks for a plain text numbered list, but the model (StepFun step-3.7-flash) sometimes returns JSON arrays despite the instruction. The B1 fix (`_extract_text_from_json_outline`) handles this for outline generation.

**Beat JSON parsing (director.py:515-533):**
The `_parse_beat_events()` method has a gap: it only searches for JSON at the START of the string (`trimmed.find("[")`). If the model prefixes the JSON with explanation text (e.g., "Here are the events:\n[...]"), the parser fails. This matches the observed Beat 1 failure.

**Scene name (director.py:242):**
`current_scene = scene_desc.split("–")[0].split(":")[0].strip()` correctly extracts the short scene name for comparison, but the `scene_change` event at line 388-396 uses the full `scene_desc` as `to_scene`, causing overly long scene names in events.

**MiniMax (provider.py:57-79):**
Confirmed 401 Unauthorized. Not a code issue.

## Spec Assessment

The host spec.md accurately captures the acceptance criteria and golden journeys. I concur with all 7 ACs and 3 golden journeys.

**One addition I would make:**
The spec should include a specific test for the `_parse_outline()` method's ability to handle the JSON fallback path, since this is the existing B1 fix that's related to the beat parsing issue.

## Divergences

None significant. The host spec is complete and accurate.
