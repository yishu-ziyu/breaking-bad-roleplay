# Dev Context

## Test Command

Backend: `.venv/bin/python -m pytest tests/ -v` (run from backend/ directory)
Frontend: `npm test` (node:test + tsx)

## Code Conduct

- SDD+TDD: write failing test first, confirm RED, minimal GREEN, verify
- No console.log in production code
- Conventional commits
- Surgical changes only

## Implementation Summary

### Task 1: Beat JSON parsing (committed: e73dff2)

**File:** `backend/agents/director.py:514-545`

Added single JSON object fallback in `_parse_beat_events()`:
1. Fenced JSON (existing)
2. Raw JSON array anywhere in text (existing, uses find/rfind)
3. **NEW:** Single JSON object wrapped in array
4. Empty list fallback

**Test file:** `backend/tests/test_director_beat_parsing.py` (5 tests)
- test_parse_plain_json_array
- test_parse_json_with_code_fence
- test_parse_json_with_extra_text_before
- test_parse_single_json_object_wraps_in_array (NEW — was failing before fix)
- test_parse_empty_returns_empty

### Task 2: Scene name extraction (committed: e73dff2)

**File:** `backend/agents/director.py:242, 382`

Fixed `current_scene` extraction in both `process()` and `_generate_beat()`:
- `current_scene = scene_desc.split("–")[0].split(":")[0].strip()` extracts short name
- `to_scene` in scene_change event uses short name
- `description` in scene_change event keeps full text

### Task 3: MiniMax removal verification (committed: e73dff2)

**Files:** `backend/agents/director.py`, `src/App.tsx`
- Backend: changed `llmProvider` default from "minimax" to "stepfun" (2 occurrences)
- Backend: updated beat prompt to reference only "stepfun/step-3.7-flash"
- Frontend: removed MiniMax option from model selector dropdown
- Frontend: changed default from "minimax" to "stepfun"

### Verification

- 15/15 backend tests pass
- SSE stream tested with StepFun — Director generates 4-scene outline, beats render with events
- Scene names in scene_change events are now short (e.g., "Remote New Mexico desert scrubland clearing") instead of full paragraphs
