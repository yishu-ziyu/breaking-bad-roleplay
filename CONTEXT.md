# CONTEXT — ABQ Roleplay Lab (Breaking Bad Roleplay)

Shared product language. Update when hard decisions land.

## Characters (playable)

| id | Display EN | Display ZH | Notes |
|----|------------|------------|--------|
| walter | Walter | 沃尔特 | Empire / pride |
| jesse | Jesse | 杰西 | Conscience / loyalty |
| skyler | Skyler | 斯凯勒 | Family pressure |
| saul | Saul | 索尔 | Criminal lawyer comic |
| mike | Mike | 麦克 | Never 米克 |
| gus | Gus | 古斯 | Controlled threat |
| hank | Hank | 汉克 | **Loop N new** — DEA; optional Story lead |

## Hank (v1)

- **Modes:** Direct + Crew + Story (selectable protagonist; also supporting cast).
- **Relations:** `family member`, `DEA partner`, `suspect under watch`, `neighbor`, `friend of the family`.
- **Voice:** Loud loyalty — jokes, minerals/beer life texture, protective of family, investigative pressure on suspects, vulnerability under the tough shell. Not a cool generic cop.
- **Assets:** Minimal GIFs (4–8), silhouette/portrait fallback; **no** cloned TTS (browser/default fallback).
- **Out of scope (Hank loop):** Marie as playable; real DEA how-to; full GIF catalog.
- **GIF rule:** first-frame visual audit required (no emotion-tag-only random Giphy).

## Story engine (McKee v1 — DEC-0003)

- Module: `backend/agents/mckee_story.py`.
- Outline: McKee spine meta + 5-7 tagged beats (`setup` → `inciting` → `progressive*` → `crisis` → `climax` → optional `resolution`).
- Each beat must state **value turn** and **gap** (expectation vs result).
- Per-beat planner injects role rules; SSE schema unchanged (`mckee_role` optional on beat events).
- Source discipline: Robert McKee *Story* (local skill extract).

## Modes

- **Direct:** one character chat with relation anchor.
- **Crew:** multi-character debate.
- **Story:** SSE beat stream; `active_character` can be any playable id including hank.

## Safety

- Fictional drama only; no real-world crime, chemistry, violence, or evasion instructions.
