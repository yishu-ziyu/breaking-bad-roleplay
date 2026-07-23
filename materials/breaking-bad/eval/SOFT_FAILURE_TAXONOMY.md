# Soft failure taxonomy (community-informed)

Used in Golden Beat `preference_reasons` and Soft Critic notes.
IDs are stable; descriptions are self-written (not Reddit quotes).

Community hubs (live misreads, rewatch debates) **seed** this list.
They do not auto-fill scores.

## Taxonomy

| id | Axis (critic) | Meaning | Typical loser pattern |
|----|---------------|---------|------------------------|
| `plot_dump` | intentionality | Line/monologue explains plot for the audience | "As you know…" exposition |
| `future_knowledge` | continuity / hard | Speaker uses facts outside horizon | s1 mouth states s5 outcomes |
| `volume_first` | intentionality | Escalates volume before character precision | Generic screaming Walter/Gus/Mike |
| `no_subtext` | dramatic_value | Surface intent equals whole meaning | Transparent plot function speech |
| `relation_wrong` | intentionality | Wrong relationship tactic for the pair | Saul as pride-partner; Mike as hysterical |
| `mask_break_cheap` | intentionality | Public mask dropped without pressure cost | Walt confesses everything for free |
| `repeat_beat` | causal_relevance | No value change vs prior beat | Same argument, no new leverage |
| `no_player_room` | dramatic_value | Closes all agency; pure cutscene | Unanswerable monologue wall |
| `unstageable` | visual_executability | Action outside ontology / no anchor | "teleport", abstract thrash |
| `empty_strategy` | intentionality | Missing goal/fear/tactic/speech_act | Only a cool one-liner |
| `audience_hate_as_policy` | intentionality | Uses fan hate as character truth | Skyler-as-villain fan service |
| `cross_series_leak` | continuity / hard | BCS/El Camino fact in default BB session | Default graph contamination |
| `prediction_as_fact` | continuity | Live-era guess written as Board truth | "Gus will definitely…" as fact |
| `meme_voice` | voice_fit | Quote-contest or meme cadence | Famous line karaoke |
| `era_bleed_voice` | intentionality / continuity | Later-arc identity spoken on earlier era board | S1 Walt Felina confession ("I liked it" / "I am the danger") |

## Mapping to Soft Critic weights

| Critic field | Primary taxonomy ids |
|--------------|----------------------|
| intentionality (30%) | `plot_dump`, `volume_first`, `relation_wrong`, `mask_break_cheap`, `empty_strategy`, `audience_hate_as_policy`, `meme_voice` |
| causal_relevance (25%) | `repeat_beat` |
| continuity (20%) | `future_knowledge`, `cross_series_leak`, `prediction_as_fact` (hard path first) |
| dramatic_value (15%) | `no_subtext`, `no_player_room` |
| visual_executability (10%) | `unstageable` |

## Golden beat usage

```json
"preference_reasons": [
  "B: plot_dump — audience exposition not Skyler tactic",
  "A: keeps knowledge rights and probe speech_act"
]
```

Prefer taxonomy **ids** in reasons so harness and humans share a vocabulary.

## Sources (locators only)

- Live incomplete reception: `hub_live_archive`, Felina / S05 premiere hubs
- Horizon discipline: `hub_rewatch_2016_nospoil`
- Mature / contaminated reads: `hub_elcamino_2019` (craft only)
