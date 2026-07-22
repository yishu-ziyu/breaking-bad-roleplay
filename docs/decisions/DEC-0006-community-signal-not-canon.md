# DEC-0006: Community signal is not canon

**Status:** accepted  
**Date:** 2026-07-22  
**Product:** ABQ Roleplay Lab / Breaking Bad roleplay  

## Context

r/breakingbad hosts multiple rewatch and live-discussion systems with different
spoiler disciplines and knowledge horizons (2016 no-spoiler rewatch, 2014–15
full-spoiler rewatch, S3+ live archive, 2019 El Camino rewatch with BCS-aware
reads). These materials are valuable for **epistemic discipline** and **soft
failure types**, and dangerous if treated as dialogue truth or Continuity facts.

## Decision

1. **Community ≠ canon.** Reddit/wiki talk never becomes Continuity Board law
   without a separate human Continuity change grounded in primary sources.
2. **Ingest only locators + self-written notes.** No comment-body dumps, no
   raw Reddit RAG, no quote karaoke as Character Policy.
3. **Four hub epochs stay labeled** in `materials/breaking-bad/community/REWATCH_HUBS.md`
   with `knowledge_horizon` and `usable_for`.
4. **Defaults:** BCS/El Camino **off** default knowledge graph; no-spoiler
   per-episode mode is **not** default UX (eval/craft first).
5. **Promotion path is human-only** (see `community/INGEST_POLICY.md`): craft
   note → golden/taxonomy → optional TEMPLATE edit → Continuity only with
   primary cross-check.
6. **Training ladder unchanged:** golden → hard eval → soft critic → then
   SFT/DPO. Community does not skip steps.

## Consequences

- Positive: preserves DEC-0005 hard/soft split; copyright-safe; prevents
  spoiler-mouth and fan-service policy.
- Cost: slower material growth; requires curators.
- Non-goal: Reddit browser product; community voting on world lines (unless
  later product decision).

## References

- `materials/breaking-bad/DESIGN.md` (Community/Critical Layer)
- `materials/breaking-bad/SOURCES.md`
- `materials/breaking-bad/community/*`
- `docs/decisions/DEC-0005-propose-validate-commit-narrative.md`
