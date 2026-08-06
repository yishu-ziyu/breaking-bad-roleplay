# BB Agent Harness

Maps [ai-agent-book](file:///Users/mahaoxuan/Desktop/AI产品经理/ai-agent-book) harness ideas onto Breaking Bad roleplay.

**Formula:** `Agent = Model + Harness`  
**Harness:** Context + Tools + Constrain + Verify + Correct  
(+ Memory layers, Trajectory, Lessons, Multi-agent orchestrator)

See [CAPABILITY_MAP.md](./CAPABILITY_MAP.md) for chapter → module status.

## Package layout

```text
backend/agents/harness/
  loop.py            # ch1 ReAct AgentLoop
  verify.py          # ch1 guardrails
  correct.py         # ch1 circuit breaker / retry / loop detect
  context.py         # ch2 status bar + assembly
  skills.py + skills/# ch2 progressive skills
  memory_layers.py   # ch3 working / episodic / semantic
  rp_tools.py        # ch4 RP tools (dossier, cast, continuity, …)
  trajectory.py      # ch6 trajectory logging
  evolution.py       # ch8 lessons from trajectories
  orchestrator.py    # ch10 multi-agent (shared | isolated)
  service.py         # product facade AgentHarnessService
```

## Try it (local backend on :8001)

```bash
# Terminal A — backend
cd backend && uvicorn main:app --reload --port 8001

# Terminal B — smoke
curl -s localhost:8001/api/agent/capabilities | jq

curl -s -X POST localhost:8001/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"message":"列出可玩角色","offline":true}' | jq

curl -s -X POST localhost:8001/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"message":"recall 关系 jesse","character_id":"walter","offline":true}' | jq '.reply,.tools_available,.trajectory_id'

curl -s -X POST localhost:8001/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"message":"开一场对峙","use_multi_agent":true,"offline":true,"character_id":"jesse"}' | jq '.reply,.meta'

curl -s 'localhost:8001/api/agent/trajectories?limit=5' | jq
curl -s localhost:8001/api/agent/lessons | jq
```

### Offline vs live

| `offline` | Keys present | Behavior |
|-----------|--------------|----------|
| `true` (default) | any | Stub path: tools + memory + guardrails, no LLM |
| `false` | yes | `AgentLoop` via app `ProviderFacade` |
| `false` | no | Falls back to offline stub |

Guest offline mode is always allowed (no quota gate on these routes).

### Offline keyword routing

- `cast` / `角色` / `可玩` → `list_cast`
- `recall` / `关系` / `dossier` → `recall_dossier`
- `director` / `导演` / `节拍` → `ask_director`
- otherwise → character-flavored line + working note / emotion tools

## API

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/agent/capabilities` | Module map + book coverage |
| POST | `/api/agent/run` | Body: `message`, optional `character_id`, `mode`, `language`, `model_route`, `use_multi_agent`, `session_id`, `offline` |
| GET | `/api/agent/trajectories?limit=10` | Recent runs |
| GET | `/api/agent/lessons` | Extracted lessons |

## Tests

```bash
cd backend && uv run pytest \
  tests/test_harness_service_api.py \
  tests/test_harness_loop.py \
  tests/test_harness_context.py \
  tests/test_harness_tools_verify.py -q
```

## Multi-agent (ch10)

```python
from agents.harness.orchestrator import MultiAgentOrchestrator, default_bb_roles

async def respond(role, messages):
    return f"{role.id}: offline line"

orch = MultiAgentOrchestrator(respond_fn=respond)
result = await orch.run("Corner Walt", default_bb_roles("walter"), mode="isolated")
# result.final_text, result.role_outputs, result.steps
```

Modes:

- **isolated** — each role private context; manager synthesizes (default)
- **shared** — one history with role tags

No concurrent file writes; pure in-memory orchestration.
