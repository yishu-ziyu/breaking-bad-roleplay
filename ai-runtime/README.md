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

If no usable live key is present, the sidecar stays on the Faux provider. Live-provider e2e is skipped unless `APODEX_API_KEY` is set (`test/credentials.test.ts`).

## Live provider (Apodex)

OpenAI-compatible. Docs: https://platform.apodex.ai/docs

```bash
# Required for a live Apodex call. Never commit this value.
APODEX_API_KEY=

# Core 1.1 (default). apodex-1.1-mini is also allowed. Not deep-research.
APODEX_MODEL=apodex-1.1

# Optional override; default is the public Apodex endpoint.
APODEX_BASE_URL=https://api.apodex.ai/v1
```

`liveProviderFromEnv` uses `provider_id=openai-compatible`, `base_url=https://api.apodex.ai/v1`, and model `apodex-1.1`.

Alternatively, `OPENAI_API_KEY` + `OPENAI_BASE_URL=https://api.apodex.ai/v1` is treated as Apodex (same provider id and 1.1 model). Other OpenAI / Anthropic / MiniMax keys remain fallbacks.

Do not put keys in the repo, `.env` examples, logs, SSE, or PR text. FastAPI never forwards a key; the sidecar reads env itself.
