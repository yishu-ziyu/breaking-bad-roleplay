# breaking-bad-roleplay-deploy

Fix build errors, configure deployment, and ship ABQ Roleplay Lab to a public URL.

## Goal

Ship the Breaking Bad roleplay app to a public, accessible URL where a user can open the page, select a character, send a message, and receive an in-character reply with GIF reaction — fully functional end-to-end.

## Definition of Done

A public URL serves the app, all 6 characters load, chat produces in-character replies, GIF reactions appear, SSE events stream, and Chinese/English UI toggle works. npm run build exits 0.

## Verification

- `build-passes` (programmatic)
- `backend-tests-pass` (programmatic)
- `all-characters-load` (judge)
- `chat-flow-works` (judge)
- `sse-streams` (judge)
- `i18n-toggle` (judge)
- `deploy-reachable` (human)

## Council

- `reviewer-1`: judge via codex (gpt-5.5-xhigh)

## Gates

- Plan gate: revise_until_clean
- Delivery gate: revise_until_clean

## Loop Control

- Max iterations: 12
- Budget: `{"tokens": 4000000, "usd": 8.0, "wall_clock_min": 60}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["same build error repeats after fix", "delivery artifact has no material change from previous", "judge verdict is unchanged despite revisions"]}`

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "requires_approval": true}`

## Observability

- State file: `state.json`
- Run log: `run-log.md`
- Checkpoint granularity: `gate`

## Flow Preview

```text
+--------------------------------+
| 1. Goal + context              |
| read sources                   |
+--------------------------------+
               |
               v
+--------------------------------+
| 2. Draft plan.md               |
| state -> state.json            |
+--------------------------------+
               |
               v
+--------------------------------+
| 3. Plan gate                   |
| verdict: reviewer-1            |
+--------------------------------+
               | needs work -> revise <= 3 -> step 2
               | pass
               v
+--------------------------------+
| 4. Write delivery-N.md         |
| log -> run-log.md              |
+--------------------------------+
               |
               v
+--------------------------------+
| 5. Delivery gate               |
| verdict: reviewer-1            |
+--------------------------------+
               | needs work -> revise <= 3 -> step 4
               | pass
               v
+--------------------------------+
| 6. Final output                |
| all gates clean                |
+--------------------------------+

Stops: pass gates | max 12 iterations | no progress x2 | budget 60m, $8.0, 4000000 tokens
```
