# Narrative pipeline (Propose → Validate → Commit)

Source of truth for open narrative work. Product language: CONTEXT.md + DEC-0005.

## What already works

- McKee story module: `backend/agents/mckee_story.py` (spine + beats).
- Beat Contract + Character Policy + World Validator + State Reducer-lite.
- Soft Critic + Golden Beats 50 under `backend/eval/golden_beats/`.

# Tasks

- [x] NAR-001 Ship McKee spine and beat outline SSE extras
  Outline SSE includes mckee_spine, mckee_warnings, mckee_beat_count.

- [ ] NAR-002 Stage Compiler v0: closed action ontology to stage cues #narrative !high
  From committed beat actions, emit future-facing 3D/stage cues without free-text chaos.
  Out of scope: full 3D renderer. Acceptance: one golden beat produces a typed cue list.

- [ ] NAR-003 Soft critic gates one bad golden beat in CI #narrative #qa !high @blocked_by:NAR-002
  Wire soft critic into eval harness so a deliberately bad sample fails with reasons.
  Run: document exact pytest path when landed.

- [ ] NAR-004 No-spoiler episode mode design note only #narrative !low
  Write design note under docs/ — not default UX. Eval/craft first (DEC-0006).
