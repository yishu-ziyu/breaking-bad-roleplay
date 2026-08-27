# AI Runtime (P1)

Node/TypeScript sidecar. FastAPI remains the only public API.

Pinned: `@earendil-works/pi-coding-agent@0.84.3` (see `PIN.md`).
Skill baseline was v0.83.0. Do not install `latest`.

## Rules

1. Game Kernel resolves the action first.
2. This process only performs an already-committed `ResolvedBeat`.
3. pi-agent never writes GameState.
4. Builtin coding tools are disabled. Allowed tools: `get_visible_game_state`, `get_character_memory`, `search_materials`.
5. Sessions are in-memory (`SessionManager.inMemory` on the pi path). Dispose / TTL / abort are implemented.
6. Thinking deltas are never forwarded.

## Run

```bash
cd ai-runtime
npm ci
npm test
AI_RUNTIME_PORT=8010 npm start
```

FastAPI:

```bash
AI_RUNTIME=legacy   # template fallback, no sidecar required
AI_RUNTIME=pi AI_RUNTIME_URL=http://127.0.0.1:8010
```

If no `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `MINIMAX_API_KEY` is present, the sidecar stays on the Faux provider. Live-provider e2e is skipped and documented by `test/credentials.test.ts`.
