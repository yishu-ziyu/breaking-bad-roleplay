# Quality / gates

Current engineering gates for the hackathon app.

## What already works

- Frontend Vite app + FastAPI backend.
- Playwright config present; some E2E debt remains.

# Tasks

- [ ] QA-001 Rewrite AC-6 tests to match current product surface #qa !high
  Replace stale AC-6 coverage so tests assert current chat/story UX, not deleted panels.

- [ ] QA-002 Backend pytest green on clean checkout #qa !high
  `cd backend && uv run pytest` — document any known skips.

- [ ] QA-003 Frontend unit + build green #qa
  `npm test` and `npm run build` pass on main.
