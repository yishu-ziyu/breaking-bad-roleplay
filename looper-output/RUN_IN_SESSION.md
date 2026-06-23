# Run `breaking-bad-roleplay-deploy` In This Session

Use this prompt when the user wants to run the Looper-designed loop in the current LLM session.
This is the default/easy execution path. The Python runner is the advanced path for running later or outside the session.

## Operator Instructions

You are executing a Looper-designed loop in this current session.
Follow the resolved spec below, write handoff files into the workspace, and enforce the caps manually.
Do not use `run-loop.py` unless the user explicitly asks for the advanced external runner.

1. Create the workspace directory if it does not exist.
2. Read the context sources before drafting the plan.
3. Draft `plan.md` in the workspace.
4. Run the plan gate. Apply programmatic checks when available. For judge criteria, use the configured judge only after consent for any non-local egress; otherwise ask the user to approve a human/current-session substitute.
5. Revise until the gate passes or `max_revisions` is reached.
6. Produce `delivery-N.md` in the workspace.
7. Run the delivery gate after each delivery.
8. Stop when all delivery criteria pass, a cap is reached, or the user stops the loop.
9. Keep `state.json` current with status, iteration, last gate, consent, and blockers.
10. Append a compact entry to `run-log.md` after every context read, model call, check, gate verdict, revision, blocker, and stop decision.
11. Compare each blocker against the previous blocker. If the same blocker repeats for the configured no-progress window, stop or ask for the configured human checkpoint instead of revising again.
12. Treat token and USD budgets as operator limits in this session: if exact accounting is unavailable, stop and ask before continuing when the loop appears likely to exceed them.

## Files

- Source spec: `loop.yaml`
- Human summary: `LOOP.md`
- Resolved spec: `loop.resolved.json`
- Workspace: `./loop-workspace`
- State file: `state.json`
- Run log: `run-log.md`

## Goal

Ship the Breaking Bad roleplay app to a public, accessible URL where a user can open the page, select a character, send a message, and receive an in-character reply with GIF reaction — fully functional end-to-end.

## Definition Of Done

A public URL serves the app, all 6 characters load, chat produces in-character replies, GIF reactions appear, SSE events stream, and Chinese/English UI toggle works. npm run build exits 0.

## Context Sources

- Read file `./README.md`
- Read file `./backend/HACKATHON_PLAYBOOK.md`
- Run command `["npm", "run", "build"]`
- Run command `["cd", "backend", "&&", "uv", "run", "pytest"]`

## Verification Criteria

- `build-passes` programmatic: run `["npm", "run", "build"]` and expect `exit_zero`
- `backend-tests-pass` programmatic: run `["bash", "-c", "cd backend && uv run pytest"]` and expect `exit_zero`
- `all-characters-load` judge rubric: Opening the app shows all 6 characters (Walter, Jesse, Skyler, Saul, Mike, Gus) selectable. No character card is broken or missing.

- `chat-flow-works` judge rubric: Selecting a character, entering a message, and receiving a reply works end-to-end. The reply is in-character (matches the selected role's personality and speech style). A GIF reaction card appears.

- `sse-streams` judge rubric: After sending a message, SSE events stream in sequence (scene_change, agent_think, agent_speak, world_state_delta). Events arrive within 5 seconds and update the UI without manual refresh.

- `i18n-toggle` judge rubric: Switching between English and Chinese updates all visible UI copy, relationship labels, and the prompt language control. No untranslated strings remain.

- `deploy-reachable` human signoff: Open the deployed URL. Select a character, send a message, confirm a reply arrives within 10 seconds.

## Council

- `reviewer-1` judge via `["codex", "exec", "--model", "gpt-5.5-xhigh"]` (non-local; timeout 600s)

## Gates

### plan_gate

- When: `after_plan`
- Policy: `revise_until_clean`
- Verdict source: `reviewer-1`
- Criteria: `all-characters-load, chat-flow-works, sse-streams, i18n-toggle`
- Max revisions: `3`

### delivery_gate

- When: `after_each_delivery`
- Policy: `revise_until_clean`
- Verdict source: `reviewer-1`
- Criteria: `build-passes, backend-tests-pass, chat-flow-works`
- Max revisions: `3`

## Loop Control

- Max iterations: `12`
- Budget: `{"tokens": 4000000, "usd": 8.0, "wall_clock_min": 60}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["same build error repeats after fix", "delivery artifact has no material change from previous", "judge verdict is unchanged despite revisions"]}`
- Human checkpoints: `after_phase1, after_phase3`
- Stop conditions:
  - all phases pass their delivery gate clean
  - max_iterations reached
  - same blocker repeats for 2 iterations
  - any budget cap exceeded
  - human stops at checkpoint

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "requires_approval": true}`

If the loop needs scheduled runs, child-agent lifecycle management, concurrency control, or restart-safe step retries, stop and tell the user this Looper spec should be handed to a durable orchestrator.

## Observability

- State file: `state.json`
- Run log: `run-log.md`
- Checkpoint granularity: `gate`

Use `state.json` for the latest resumable status and `run-log.md` for the append-only history of what happened.

## Privacy

- Before sending `plan, deliveries` to `reviewer-1`, confirm consent and apply redactions `.env, .env.local, secrets/**, **/*.key`.

## Start Now

If the user asked to run now, begin at step 1 under Operator Instructions and keep going until a stop condition is reached.
