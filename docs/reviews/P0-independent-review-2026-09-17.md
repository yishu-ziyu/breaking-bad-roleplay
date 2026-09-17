# P0 independent code review — reliable Story and Direct memory

Date: 2026-09-17
Baseline: `55df802`
Scope: the complete uncommitted P0 diff plus the current Story / Direct / Crew
entry paths. This review did not rely on the implementation summary: it re-read
the actual routes, transaction boundary, world reducer, model prompt assembly,
client recovery path, migration, and executable tests.

## Result

No known release-blocking code finding remains in the reviewed scope. The P0 is
ready to be committed and then reviewed against a migrated staging database.
It has **not** been committed, pushed, migrated on production, or deployed.

## Findings resolved during review

| Severity | Finding | Resolution and evidence |
|---|---|---|
| High | Runtime-v1 player actions and generated outlines were not part of the committed public outbox. A pending command resumed after refresh could therefore show the consequence but lose the player's move. | `player_turn` and `outline` are now whitelisted public events, committed before SSE, replayed with stable event IDs, and consumed by `useStoryStream`. E2E covers uncertain acknowledgements, pending-command refresh, exact replay, and one-copy rendering. |
| High | `WorldState.player_view()` exposed internal `known_by` / `heard_by`, unrelated private promises, and internal trust state. | Player view now projects only visible item fields, heard claims, player-involved promises, and no trust score. Backend regression tests exercise the redaction. |
| High | Replaying an older saved beat could overwrite the current player identity with that beat's historical `player_actor_id`. | Identity updates are revision-gated; an older outbox can be replayed without rewinding the current perspective. A unit contract covers older/equal/newer revisions. |
| High | Arbitrary `command_id` text could contain SSE control characters, and runtime-v1 controls other than `act` could omit the id/revision needed for reliable retry. | Command IDs now use a restricted protocol-safe pattern. Every mutating runtime-v1 control requires `command_id` and `expected_revision`; replay remains read-only. API tests cover both cases. |
| High | The new renderer buffered dialogue but discarded Director `scene_change` narration, producing dialogue without the player-facing scene prose. | Accepted scene narration is retained and sanitized by the outbox whitelist. A transaction-level renderer test proves it survives while private fields do not. |
| Medium | Generic custom Story sessions inherited an arbitrary `s3_mid` canon pack. | Custom Story projections now start with a blank fact/tension/cost board. The board remains authoritative for physical effects, so removing canon leakage does not reopen model-authored transfers or repairs. |
| Medium | Full display names such as `Jesse Pinkman` failed deterministic presence/transfer checks that used short IDs. | Player, cast, holders, listeners and targets are normalized to canonical actor IDs before rule checks and player projection. |
| Medium | Live `beat_ready` events were not stored in the client feed. Replaying beat 2 could therefore erase the first beat because the client had no committed boundary. | `beat_ready` now enters the deduplicated feed. A two-beat E2E proves replay removes only the selected beat and retains prior manuscript content. |
| Medium | Story claims and unresolved promises could grow without a bound and inflate every snapshot and model input. | Transient claims retain the latest 48; resolved promises retain a bounded tail; more than 16 unresolved promises are explicitly rejected instead of silently growing state. Unresolved commitments are never compacted away. |
| Medium | The reconnect watchdog performed network side effects from inside a React state updater and carried two hook dependency warnings. | Connection state and reconnect callbacks now use refs; reconnect happens outside state reducers. ESLint is clean with zero warnings. |
| Medium | Two large active Playwright suites asserted deleted landing/sidebar UI. Their failures obscured current regressions. | Historical source was moved to `docs/archive/e2e/2026-09-17/`. Still-valid behavior was migrated to current suites, including a new focused `current-interactions.spec.ts`. Default Playwright now exercises current product contracts only. |
| Low | README, AS_BUILT, architecture boundaries, API paths, test commands and migration notes disagreed with the current code. | Documentation now describes the three-card entry, runtime-v1 command/outbox path, Direct memory semantics, current API, intentional test port override, and the `backend/story/` ownership boundary. |

## Invariants independently verified

- An LLM candidate is buffered until world validation and the database commit
  succeed; failed generation or failed commit publishes no partial candidate.
- The session revision, world snapshot, `story_turns` record, public event
  outbox and persisted character dialogue are committed in one transaction.
- The same `(session_id, command_id, request_hash)` replays the same events;
  a changed payload under the same ID is rejected.
- A fencing token prevents two generators from committing one pending command;
  stop/pause prevents claim renewal and releases/refunds unfinished work.
- Model-authored free-text effects never become authoritative item ownership,
  condition, presence, promise or trust changes.
- Direct's compact dossier supplements rather than replaces the core character
  policy. Five memory categories arrive as attributed data, not instructions or
  verified Story facts.
- Story state and event recovery require the session ownership key, and the
  new server-only tables have PostgreSQL RLS enabled by migration.

## Validation at reviewed state

- Frontend unit/component tests: **208 passed**.
- Backend tests: **706 passed**.
- Current Playwright contracts: **48 passed**, with the auth contract skipped
  by default unless `AUTH_E2E=1` is supplied.
- Auth profile contract with its fake Supabase environment: **1 passed**.
- TypeScript/Vite production build: passed. The existing bundle-size warning
  remains informational.
- ESLint: passed with zero warnings.
- Ruff over every changed backend module and new backend test: passed.
- `git diff --check`: passed.
- Full PostgreSQL Alembic chain in offline SQL mode: passed; it creates
  `story_turns` and enables RLS on both `sessions` and `story_turns`.

## Known limits, not represented as completed work

- No live-provider performance evaluation was run. Mock transports prove
  contracts and isolation, not whether seven characters are dramatically good.
- Runtime-v1 world actions are deliberately finite. Unsupported physical acts
  are rejected; Crew interruption/arbitration remains a separate P1.
- The migration was validated on SQLite round-trip and generated PostgreSQL
  SQL, but has not been applied to a staging or production database.
- Production smoke, quota spend observation and rollback rehearsal still belong
  to the deployment step.
- The frontend production bundle remains above Vite's 500 kB advisory threshold;
  code splitting is useful but unrelated to this correctness P0.
- Two backend warnings remain dependency/test-harness debt: Starlette's current
  TestClient/httpx deprecation and one mocked async connection cancellation
  warning. Neither changed the test result, but they should be removed during a
  dependency-maintenance pass rather than hidden here.

## Post-Review Working Tree Updates & Latest Verification (2026-09-17)

The initial review above was conducted directly against baseline `55df802`. Following that review, further engineering cleanups and regressions were resolved in the current working tree before final handover:

1. **E2E Test Debt & Consolidation**:
   - Retired legacy landing tests (`interaction-qa.spec.ts`, `ix-qa.spec.ts`), moving their historical sources to `docs/archive/e2e/2026-09-17/`.
   - Consolidated active contracts into `current-interactions.spec.ts` and `reliable-story-memory.spec.ts`, strictly guarding the three-card showcase and runtime-v1 invariants.

2. **Stream Transport Clean Closure Fix**:
   - Resolved a critical regression in `src/hooks/useStoryStream.ts` and `src/lib/sseFetch.ts` where natural SSE close after `beat_ready`, `complete`, or `stop` erroneously triggered `handleUnexpectedTransportEnd` due to asynchronous React ref lag and missing terminal-state guards.
   - Added synchronous `updateConnectionState` ensuring `connectionStateRef.current` matches hook state immediately.
   - Prevented client-aborted streams from dispatching spurious `onClose` events in `sseFetch.ts`.

3. **RLS Migration Offline Chain**:
   - Validated migration `i9j0k1l2m3n4_lock_server_tables_rls.py` alongside `h8i9j0k1l2m3_story_command_ledger.py` via offline PostgreSQL SQL generation (`python -m alembic upgrade head --sql`).

### Latest Working Tree Test Validation

- **Frontend unit/component tests**: **211 passed** (39 suites, 0 failed).
- **Backend tests** (`pytest`): **717 passed** (0 failed).
- **Default Playwright E2E suite** (`npx playwright test`): **51 passed**, 2 skipped (auth suite requiring `AUTH_E2E=1`).
- **Auth Playwright E2E suite** (`AUTH_E2E=1` with fake Supabase): **2 passed** (total **53 passed**, 0 failed).
- **TypeScript / Vite production build** (`npm run build`): passed.
- **ESLint** (`npm run lint`): passed with 0 errors and 0 warnings.
- **Ruff on all modified backend modules**: passed with 0 errors.
- **Git diff check** (`git diff --check`): passed cleanly.
- **Alembic offline SQL generation**: passed through head `i9j0k1l2m3n4`.
- **Status**: Ready for independent reviewer final inspection. Strictly uncommitted, unpushed, undeployed.
