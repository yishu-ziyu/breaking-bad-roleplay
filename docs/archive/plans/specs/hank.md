# Hank playable character

Hank is playable in Direct / Crew / Story. Voice and relations in CONTEXT.md.

## What already works

- Character id `hank` in playable set.
- Modes Direct + Crew + Story selectable.
- Relation anchors: family member, DEA partner, suspect under watch, neighbor, friend of the family.

# Tasks

- [ ] HANK-001 GIF first-frame visual audit for Hank pool #hank #gif !high
  Audit 4–8 Hank GIFs: first frame must match emotion tag; no random Giphy by tag alone.
  Acceptance: checklist in materials or docs; broken assets removed.

- [ ] HANK-002 Silhouette/portrait fallback when GIF missing #hank #ux !low @blocked_by:HANK-001
  UI shows portrait fallback, never broken image, when GIF pool empty.

- [ ] HANK-003 No cloned TTS for Hank (browser fallback only) #hank
  Confirm no public/voice clone for Hank; disabled placeholder is OK.
