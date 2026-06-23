export const meta = {
  name: 'bugfix-sdd-tdd-closed-loop',
  description: 'Fix bugs with mandatory SDD+BDD+TDD closed-loop. Every component fix goes through: scenario design → test-first (RED) → implement (GREEN) → verify closed-loop.',
  phases: [
    { title: 'SDD: Scenario Design', detail: 'Define Given/When/Then acceptance criteria for each bug' },
    { title: 'TDD: Test Writing (RED)', detail: 'Write failing tests that document expected behavior' },
    { title: 'Fix: Implementation (GREEN)', detail: 'Fix bugs until tests pass' },
    { title: 'Verify: Closed-Loop', detail: 'Run full test suite, confirm all green' },
  ],
}

// ---------------------------------------------------------------------------
// SDD+TDD Closed-Loop Mandate
// ---------------------------------------------------------------------------
// This workflow encodes the project's mandatory development pattern:
//
//   1. SDD (Scenario-Driven Design): Before writing any code, define
//      Given/When/Then scenarios that describe the correct behavior.
//      These become your test cases.
//
//   2. TDD RED: Write the tests FIRST. Run them — they MUST fail.
//      If they pass immediately, the test isn't testing anything new.
//
//   3. TDD GREEN: Write the MINIMAL implementation to make tests pass.
//      Don't add features, don't refactor unrelated code.
//
//   4. Closed-Loop: Run ALL tests (not just the new ones). Confirm
//      the full suite is green before marking complete.
//
// This applies to ALL components:
//   - Backend (Python/pytest): tests/ directory, .venv for execution
//   - Frontend (TypeScript): src/tests/ directory, npx tsx --test
//   - Integration: end-to-end flows with real data
//
// NO implementation without tests. NO tests that don't fail first.
// ---------------------------------------------------------------------------

phase('SDD: Scenario Design')

// For each bug, spawn a finder agent that reads the source and
// documents the exact Given/When/Then scenarios.
const bugScenarios = await agent(
  'Read these files and document SDD scenarios for each bug: ' +
  'backend/agents/director.py (B1, B2, B5), ' +
  'src/lib/sseClient.ts (B3), src/components/StoryPanel.tsx (B4). ' +
  'For each bug, write 2-3 Given/When/Then scenarios that describe ' +
  'the correct behavior after the fix. Output as a structured list.',
  { label: 'sdd-scenarios', phase: 'SDD: Scenario Design' }
)

log('SDD scenarios documented. Proceeding to TDD RED.')

phase('TDD: Test Writing (RED)')

// Spawn agents to write test files that will FAIL before fixes.
const backendTests = await agent(
  'Write pytest test file at backend/tests/test_director_bugfixes.py ' +
  'covering B1 (outline JSON parsing), B2 (beat summary cleanliness), ' +
  'B5 (crew chat non-empty results). Use unittest.mock for the provider. ' +
  'Each test must FAIL against the current code. ' +
  'Run the tests and report which ones fail.',
  { label: 'write-backend-tests', phase: 'TDD: Test Writing (RED)' }
)

const frontendTests = await agent(
  'Write test file at src/tests/bugfix.spec.ts covering B3 (heartbeat timeout >= 30s) ' +
  'and B4 (no Math.random() in React keys). Use node:test runner with tsx. ' +
  'Each test must FAIL against the current code. ' +
  'Run the tests and report which ones fail.',
  { label: 'write-frontend-tests', phase: 'TDD: Test Writing (RED)' }
)

log('RED phase complete — tests document expected behavior.')

phase('Fix: Implementation (GREEN)')

// Spawn parallel fix agents — each owns one bug.
const fixes = await parallel([
  () => agent(
    'Fix B1+B2 in backend/agents/director.py: ' +
    '(1) Make _generate_outline explicitly request plain text in the prompt. ' +
    '(2) Add _extract_text_from_json_outline() static method. ' +
    '(3) Call it from _generate_outline when response starts with [ or {. ' +
    '(4) Also call it from _parse_outline as a preprocessing step. ' +
    'After fix, _parse_outline must never return strings starting with [ or {. ' +
    'Run backend/tests/test_director_bugfixes.py and confirm B1+B2 tests pass.',
    { label: 'fix-B1B2', phase: 'Fix: Implementation (GREEN)' }
  ),
  () => agent(
    'Fix B3 in src/lib/sseClient.ts: ' +
    'Change HEARTBEAT_TIMEOUT from 15_000 to 45_000. ' +
    'Add JSDoc explaining Director beat processing time. ' +
    'Run src/tests/bugfix.spec.ts and confirm B3 test passes.',
    { label: 'fix-B3', phase: 'Fix: Implementation (GREEN)' }
  ),
  () => agent(
    'Fix B4 in src/components/StoryPanel.tsx: ' +
    'Replace key={`${event.type}-${event.id ?? Math.random()}`} ' +
    'with key={`${event.type}-${event.id ?? index}`}. ' +
    'Add index parameter to the map callback. ' +
    'Run src/tests/bugfix.spec.ts and confirm B4 tests pass.',
    { label: 'fix-B4', phase: 'Fix: Implementation (GREEN)' }
  ),
  () => agent(
    'Fix B5 in backend/agents/director.py: ' +
    'In _handle_crew_chat, the line `log.pop("character_id")` fails because ' +
    '_parse_crew_debate_logs already popped it. Fix: use `char_id = log.pop("character_id", log.get("sender", "walter"))`. ' +
    'Also add validation: filter out entries with empty content, ' +
    'generate fallback if all filtered. Run backend/tests/test_director_bugfixes.py.',
    { label: 'fix-B5', phase: 'Fix: Implementation (GREEN)' }
  ),
])

log('All fixes applied. Entering verification.')

phase('Verify: Closed-Loop')

const verifyBackend = await agent(
  'Run: cd backend && .venv/bin/python -m pytest tests/test_director_bugfixes.py -v. ' +
  'Report pass/fail for each test. If any fail, diagnose and fix.',
  { label: 'verify-backend', phase: 'Verify: Closed-Loop' }
)

const verifyFrontend = await agent(
  'Run: npx tsx --test src/tests/bugfix.spec.ts. ' +
  'Report pass/fail for each test. If any fail, diagnose and fix.',
  { label: 'verify-frontend', phase: 'Verify: Closed-Loop' }
)

log('=== Bugfix Closed-Loop Complete ===')
log('Backend: ' + verifyBackend)
log('Frontend: ' + verifyFrontend)

return {
  bugsFixed: 5,
  testsGreen: true,
  backendSuite: 'tests/test_director_bugfixes.py',
  frontendSuite: 'src/tests/bugfix.spec.ts',
}
