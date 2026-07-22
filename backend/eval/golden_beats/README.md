# Golden Beats (first batch)

Adjudicated Story samples for DEC-0005 hard evaluation.

Each `gb_*.json` file:

| Field | Meaning |
|-------|---------|
| `id` | Stable case id |
| `world_mode` | `canon` \| `alternate` \| `sandbox` |
| `context.board` | Continuity Board slice (facts, cast, costs) |
| `beat_contract` | Director Beat Contract |
| `candidates.a` / `b` | Turn Proposals (Character Policy shape) |
| `preferred` | Winner key |
| `hard_failures` | Map candidate → expected hard error codes |
| `preference_reasons` | Why the loser fails (human + soft axes) |

Run:

```bash
cd backend && uv run pytest tests/test_golden_beats.py -q
```

Grow toward 50–100 cases. Always store **why the other answer is wrong**.
