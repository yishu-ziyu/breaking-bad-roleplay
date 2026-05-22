# Role Library Architecture

## Purpose

Define the scalable role-level material library for ABQ Roleplay Lab. The library stores copyright-safe role behavior, retrieval metadata, prompt rules, relationship dynamics, and vetted media references. It must not store full scripts, subtitles, transcript dumps, bulk quote collections, or long copyrighted dialogue.

Walter is the first complete template. Other roles become production-ready only after they match Walter's role kernel, relationship coverage, retrieval units, media metadata, safety rules, and acceptance checks.

## Directory Layout

```text
materials/breaking-bad/
  ROLE_LIBRARY_ARCHITECTURE.md
  SOURCES.md
  DESIGN.md
  INGESTION_SCHEMA.md
  VOICE_PROFILES.md
  RELATION_MATRIX.md
  WALTER_TEMPLATE.md
  roles/
    walter/
      role.json
      voice_rules.jsonl
      relationship_rules.jsonl
      retrieval_units.jsonl
      media_assets.jsonl
      safety_rules.jsonl
      acceptance_checks.md
    jesse/
    skyler/
    saul/
    mike/
    gus/
  shared/
    sources.jsonl
    episodes.jsonl
    production_notes.jsonl
    relationship_dynamics.jsonl
    safety_boundaries.jsonl
    media_taxonomy.jsonl
```

## JSONL Schemas

### `roles/{role_id}/role.json`

```json
{
  "role_id": "walter",
  "display_name": "Walter",
  "series": "Breaking Bad",
  "template_status": "complete",
  "supported_languages": ["en", "zh"],
  "default_relation": "former student",
  "relation_options": ["former student", "family member", "lab partner", "DEA liability", "old colleague"],
  "role_kernel": {
    "public_mask": "careful teacherly control",
    "inner_engine": "pride, grievance, fear of humiliation",
    "main_contradiction": "frames domination as responsibility",
    "failure_mode": "becomes precise, corrective, morally self-justifying, then threatening"
  },
  "copyright_text_stored": false
}
```

### `voice_rules.jsonl`

```json
{
  "rule_id": "walter_voice_001",
  "role_id": "walter",
  "time_period": "default",
  "voice_tags": ["controlled", "technical", "defensive"],
  "rule": "Use calm technical framing to turn emotional conflict into control.",
  "prompt_use": "Prioritize controlled correction and self-justifying logic.",
  "source_refs": ["src_fandom_walter", "src_harvard_gazette_gilligan"],
  "confidence": "medium",
  "copyright_text_stored": false
}
```

### `relationship_rules.jsonl`

```json
{
  "rule_id": "walter_rel_former_student",
  "role_id": "walter",
  "relation": "former student",
  "baseline": "disappointed teacher plus possessive mentor",
  "trust_level": "low_to_medium",
  "pressure_style": ["correction", "interrogation", "controlled disappointment"],
  "conflict_hook": "the user wants respect; Walter wants obedience",
  "prompt_use": "Sound corrective and paternal while carrying leverage and defensive pride.",
  "source_refs": ["src_fandom_walter"],
  "confidence": "medium"
}
```

### `retrieval_units.jsonl`

```json
{
  "unit_id": "walter_control_authority_001",
  "role_id": "walter",
  "unit_type": "analysis_note",
  "text": "Walter treats fear as incompetence and tries to recover authority through technical certainty.",
  "tags": ["control", "authority", "fear", "technical dominance"],
  "relations": ["former student", "lab partner"],
  "emotion_states": ["controlled pressure", "wounded pride"],
  "source_refs": ["src_fandom_walter"],
  "copyright_text_stored": false,
  "license_basis": "self_written_analysis"
}
```

### `media_assets.jsonl`

```json
{
  "asset_id": "walter-controlled-glare",
  "role_id": "walter",
  "source": "giphy",
  "url": "https://media.giphy.com/media/3oFzm9r8nz1CmqYtmU/giphy.gif",
  "tags": ["default", "glare", "tense", "confrontation"],
  "usage_notes": "General Walter fallback for clipped, defensive, or intimidating replies.",
  "safety_notes": "Use only for fictional tension; do not pair with actionable wrongdoing.",
  "copyright_notes": "Externally hosted GIF; verify platform terms before production use."
}
```

## Retrieval Flow

1. Normalize request context: `role_id`, `relation`, `language`, `chat_mode`, recent history, user message, inferred emotion, and safety category.
2. Load role kernel from `role.json`.
3. Retrieve 3-5 `voice_rules` by role, language compatibility, tags, and confidence.
4. Retrieve 1-2 `relationship_rules` matching the selected relationship.
5. Retrieve up to 2 `retrieval_units` matching emotion, topic, and relation.
6. Retrieve 1 safety rule from shared safety boundaries or role-specific safety rules.
7. Deduplicate by `source_refs` and prefer high-confidence, short, prompt-ready material.
8. Return a compact material packet, not raw source text.

## Prompt Assembly Flow

1. System layer: role identity, immersion rules, global safety boundaries, output JSON schema.
2. Role layer: role kernel plus selected voice rules.
3. Relationship layer: selected relationship rule and power dynamic.
4. Context layer: chat mode, recent history, user message, target language.
5. Safety layer: explicit refusal/redirect instruction for real-world crime, violence, evasion, chemistry procedures, drug production, money laundering, weapons, or operational wrongdoing.
6. Media instruction: request `gif_search_query` only when a visual beat improves the scene.
7. Output layer: require JSON with `reply_text`, `emotion_state`, and `gif_search_query`.

Prompt assembly must inject abstract behavior rules and self-written analysis only. It must not inject copied dialogue, transcript spans, subtitle text, or recognizable monologues.

## Media Selection Flow

1. Model returns `gif_search_query` and `emotion_state`.
2. Normalize query with role id, emotion, relationship, and message topic.
3. Search only `roles/{role_id}/media_assets.jsonl`.
4. Match by tags first; fall back to role default only if available.
5. If no vetted role asset exists, return no media rather than borrowing another role's media.
6. Suppress media for opening lines and low-visual scenes.
7. Keep asset safety notes available to prevent pairing visual media with illegal procedural content.

## Copyright And Safety Boundaries

- Do not save full scripts, subtitles, SRT files, transcript dumps, or bulk quote collections.
- Do not create embeddings or fine-tuning data from copyrighted dialogue corpora.
- Do not store "all lines by character" datasets.
- Store source links, locators, episode metadata, scene functions, tags, and self-written analysis.
- Short quotes may be used only as source locators when legally appropriate; prompt assembly should avoid quoting them.
- Do not imply Sony, AMC, cast, or creator endorsement.
- For real clips, stills, audio, video, or substantial dialogue excerpts, use the Sony licensing route.
- The roleplay engine must redirect requests for actionable crime, violence, evasion, chemistry procedures, drug production, money laundering, weapons, or operational wrongdoing into fictional consequences and character tension.

## Walter As Copy Template

Walter is the first complete template because he already has role kernel, voice rules, relationship rules, emotion tags, visual tags, prompt assembly snippet, and acceptance checks.

To copy Walter to another role:

1. Create `roles/{role_id}/`.
2. Copy Walter's file set and replace all `walter` ids.
3. Rewrite the role kernel from that character's own motivation and contradiction.
4. Write at least 10 voice rules and 5 relationship rules.
5. Add retrieval units as self-written analysis only.
6. Add media assets only after each asset has role-specific tags, usage notes, safety notes, and copyright notes.
7. Run acceptance checks that prove the role is not generic, not borrowing Walter's pressure style, and not using another character's media.
8. Mark `template_status` as `complete` only after prompt and media checks pass.

## Integration Recommendations

1. Keep app code stable until the material files are reviewed; the current runtime already has clear integration points in `buildSystemPrompt`, `buildContextPrompt`, and `resolveGif`.
2. Next implementation step should migrate hardcoded role/GIF data out of `src/App.tsx` toward a generated or imported registry shaped like `src/roleAssets.ts`.
3. Treat `WALTER_TEMPLATE.md` as the human-readable authoring guide and the proposed `roles/walter/*.jsonl` files as the machine-readable runtime source.
4. Add a lightweight validator before runtime use: required fields, `copyright_text_stored === false`, role-scoped media only, and no oversized text fields.

## Current Integration Points

- `src/App.tsx`: role definitions, prompt assembly, and prototype GIF selection still live in the app.
- `src/roleAssets.ts`: typed role asset registry created as the target shape for media selection.
- `materials/breaking-bad/WALTER_TEMPLATE.md`: first complete human-authored role template.
- `materials/breaking-bad/VOICE_PROFILES.md`: cross-character voice fidelity layer.
- `materials/breaking-bad/RELATION_MATRIX.md`: relationship-dependent pressure and safety layer.
- `materials/breaking-bad/SOURCES.md`: source and copyright boundary index.
