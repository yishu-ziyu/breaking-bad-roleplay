# 2026-09-17 E2E contract migration

`interaction-qa.legacy.ts` and `ix-qa.legacy.ts` describe the deleted
landing-screen / always-open sidebar version of the product. They are retained
as historical evidence, not executed by Playwright.

Their still-valid behavior was moved to current contracts instead of being
silently discarded:

| Historical concern | Current executable coverage |
|---|---|
| First entry and three play modes | `tests/e2e/cold-open-drama.spec.ts` |
| Story pause, continue, redirect, perspective, completion and error states | `tests/e2e/sse-story.spec.ts` |
| Command idempotency, refresh recovery, exact replay and Direct memory | `tests/e2e/reliable-story-memory.spec.ts` |
| Pending commands, chat stop, keyboard focus, IME and failed-send rollback | `tests/e2e/current-interactions.spec.ts` |
| Direct payloads, API failures, Story stop and legacy-save resume | `tests/e2e/functional-components.spec.ts` |
| Chat persistence, scene background, voice and Crew rendering | `tests/e2e/first-immersive.spec.ts` |

Do not reactivate these archived files by restoring obsolete selectors such as
`.landing-screen`, the old `view/mode` switches, or an always-visible sidebar.
New tests should describe the current product surface and a user-observable
contract, not the location of controls that no longer exist.
