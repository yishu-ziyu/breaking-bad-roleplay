# Continuity Board - shared room memory

Date: 2026-07-13  
Status: v0 design for Loop 8 writers-room architecture

## Problem

Today each Character Agent rewrites one line without a shared ledger.  
Director invents facts; nobody owns "what is true now" or "who knows it".

## One claim

**Continuity Board is session law, not flavor text.**  
If a fact is not on the board (or not marked known_by for a speaker), the agent may not act as if it is public.

---

## Board object (session-scoped)

```json
{
  "session_id": "…",
  "era": "s3_mid",
  "location": "superlab",
  "present_cast": ["walter", "jesse"],
  "shared_facts": [
    {
      "id": "fact_001",
      "text": "The cook partnership is under Gus's roof.",
      "known_by": ["walter", "jesse", "gus", "mike"],
      "hidden_from": ["skyler", "saul"],
      "irreversible": false,
      "source_beat": 0
    }
  ],
  "open_tensions": [
    {
      "id": "ten_001",
      "text": "Jesse wants out of the next violence cycle; Walt wants control restored.",
      "parties": ["walter", "jesse"]
    }
  ],
  "irreversible_costs": [],
  "player_relation": {
    "to_character": "walter",
    "relation": "former student",
    "trust": 0.35
  },
  "updated_at_beat": 0
}
```

### Field rules

| Field | Rule |
|-------|------|
| `era` | Locks knowledge ceiling. Agents may not use later-era facts. |
| `present_cast` | Only these mouths may speak this beat. |
| `shared_facts` | Public-to-the-listed-knowers only. |
| `known_by` / `hidden_from` | Knowledge rights. |
| `irreversible` | Once true, cannot be soft-retconned (death, exposure, major betrayal). |
| `open_tensions` | Agenda collisions the Beat Captain must pressure. |
| `irreversible_costs` | Running list of prices already paid. |

---

## Era packs (knowledge ceilings)

Use one pack per session start. Expand later; these cover product cast.

### `s1_early` (Pilot-ish)

- Walt: cancer diagnosis private-ish; Gray Matter wound active; not yet "empire".  
- Jesse: small-time, not yet broken by Jane/Brock.  
- Skyler: senses oddness, not yet co-conspirator.  
- Saul: not in play.  
- Mike/Gus: not in play (or only as distant rumors).

### `s3_mid` (Fly / Half / Full Measures neighborhood) - **default story sandbox**

- Walt + Jesse cook under Gus.  
- Mike is Gus's discipline.  
- Saul is transactional counsel.  
- Skyler knows something is wrong; depth varies by scenario flag.  
- Gale / lab politics may exist as board facts only if injected.

### `s5_end` (Ozymandias / Felina)

- Empire collapsed or collapsing.  
- Family exposure high.  
- Many deaths irreversible on board.  
- Agents must speak from end-state wounds, not S1 humility.

---

## Who may write the board

| Writer | May add | May not |
|--------|---------|---------|
| Showrunner (session start) | era, initial facts, cast, relation | mid-beat improvisation that contradicts era |
| Beat Captain / Director | facts that occurred on-screen this beat | secret private thoughts as public facts |
| Character Agent | private `thinking` only | invent public world facts |
| Continuity checker (future) | flag contradictions | invent plot |

---

## Injection into Character Agent

At speak time, inject only:

1. `era`  
2. `location`  
3. facts where `character_id ∈ known_by`  
4. open tensions involving this character  
5. player relation  
6. last 1-2 irreversible costs relevant to this character  

Never inject the full board dump if it includes secrets the speaker should not know.

### Prompt fragment (template)

```text
CONTINUITY BOARD (session law):
- Era: {era}
- Location: {location}
- You know: {known_facts_bullets}
- You do NOT know / must not reveal as fact: {hidden_hints}
- Open tension: {tension}
- Irreversible costs already paid: {costs}
If you need a new public fact, do not invent it; stay inside this board.
```

---

## Shared room examples

### Example A - Fly room (Walt + Jesse)

Shared:

- They are alone in the lab overnight.  
- Contamination / purity anxiety is Walt's obsession.  
- Jesse is exhausted and wants to finish and leave.

Hidden:

- Skyler does not know they are here.  
- Gus may monitor systems, but is not present in dialogue.

### Example B - Family kitchen (Walt + Skyler)

Shared:

- Marriage under strain.  
- Money story is incomplete / contradictory.

Hidden (unless board flips):

- Specific operational details of cooks, bodies, partners.

### Example C - Saul office (Saul + client)

Shared:

- Client is in legal heat.  
- Saul sells options, not bravery.

Hidden:

- Full map of Gus's organization unless previously established.

---

## Implementation path (code, next)

1. Add `ContinuityBoard` pydantic model in backend.  
2. Session create initializes from `era` pack JSON.  
3. After each beat, Director proposes `board_delta`; checker accepts/rejects.  
4. Character `system_prompt` assembly appends filtered board fragment.  
5. UI: optional "Room board" debug drawer for playtest (not required for ship).

Data files to add later:

```text
materials/breaking-bad/continuity/
  eras/s1_early.json
  eras/s3_mid.json
  eras/s5_end.json
```

---

## Acceptance checks

- A Jesse agent in `s1_early` never references Brock.  
- A Skyler agent without fact membership never "knows" superlab details.  
- After an irreversible cost is written, later beats cannot pretend it did not happen.  
- Crew mode: each speaker receives different known_by slices of the same board.
