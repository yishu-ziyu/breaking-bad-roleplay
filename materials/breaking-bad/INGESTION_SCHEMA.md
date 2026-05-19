# 素材库 Ingestion Schema

## 核心原则

检索库索引自写分析，不索引受版权保护对白全文。

## `sources.jsonl`

```json
{
  "source_id": "sony_licensing",
  "url": "https://www.sonypicturesstudios.com/filmclipandstilllicensing.php",
  "type": "official_licensing",
  "reliability": "highest",
  "legal_status": "licensed_required",
  "accessed_at": "2026-05-19"
}
```

## `episodes.jsonl`

```json
{
  "series": "Breaking Bad",
  "season": 1,
  "episode": 1,
  "title": "Pilot",
  "air_date": "2008-01-20",
  "writer": ["Vince Gilligan"],
  "director": ["Vince Gilligan"],
  "external_ids": {
    "imdb": "tt0959621",
    "tmdb": null,
    "wikidata": null
  }
}
```

## `voice_rules.jsonl`

```json
{
  "character": "Walter White",
  "time_period": "early_s1",
  "voice_tags": ["controlled", "defensive", "technical", "status-anxious"],
  "rhetorical_patterns": ["justification", "correction", "authority assertion"],
  "relationship_effect": {
    "former student": "pedagogical, superior, corrective",
    "family member": "protective but defensive"
  },
  "prompt_use": "Use calm technical framing to turn emotional conflict into control.",
  "source_refs": ["src_fandom_walter", "src_harvard_gazette_gilligan"],
  "copyright_text_stored": false
}
```

## `production_notes.jsonl`

```json
{
  "source_id": "wgf_inside_writers_room",
  "medium": "panel",
  "speaker": "Vince Gilligan",
  "character_focus": ["Walter", "Jesse"],
  "craft_axis": ["writers_room", "character_logic", "plot_rule"],
  "dramatic_rule": "Story decisions should arise from character pressure rather than arbitrary twists.",
  "usable_prompt_rule": "When retrieval injects this note, force the reply to reveal motive through relationship pressure.",
  "canon_confidence": "high",
  "quote_stored": false
}
```

## `relationship_dynamics.jsonl`

```json
{
  "pair": ["Walter", "Jesse"],
  "dynamic": "A teacher-student hierarchy mutates into dependence, coercion, guilt, and intermittent care.",
  "usable_prompt_rule": "Walter should sound corrective and paternal, while the subtext carries leverage and defensive pride.",
  "source_refs": ["src_fandom_walter", "src_fandom_jesse", "src_reddit_walt_jesse_relationship"],
  "confidence": "medium"
}
```

## `retrieval_units.jsonl`

```json
{
  "unit_id": "bb_s01e01_walter_arc_note_001",
  "unit_type": "analysis_note",
  "text": "Walter frames fear as incompetence and tries to recover authority through technical certainty.",
  "source_locator": {
    "episode": "S01E01",
    "source_url": "authorized viewing or metadata URL"
  },
  "retrieval_tags": ["Walter", "control", "fear", "chemistry", "authority"],
  "copyright_text_stored": false,
  "license_basis": "metadata_only"
}
```

## Prompt 注入格式

```text
[Retrieved Character Notes]
- Voice rule: ...
- Relationship dynamic: ...
- Current arc state: ...
- Critical warning: ...

Do not quote or closely paraphrase source dialogue. Generate original dialogue consistent with these abstract traits.
```
