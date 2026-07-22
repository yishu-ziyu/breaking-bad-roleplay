# Golden Beats (50-case batch)

Adjudicated Story samples for DEC-0005 hard + soft evaluation.

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
| `preference_reasons` | **Why the other answer is wrong** (required) |

Harness:

1. Preferred must hard-pass (unless listed).
2. Losers must hit listed hard codes when provided.
3. If **both** hard-pass, soft critic must rank `preferred` higher.

Run:

```bash
cd backend && uv run pytest tests/test_golden_beats.py tests/test_soft_critic.py -q
```

Grow toward 100+. Always store **why the other answer is wrong**, not only the winner.
