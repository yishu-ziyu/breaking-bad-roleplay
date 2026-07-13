# Teleplay craft notes (analysis only)

Date: 2026-07-13

Sources for study locators: `../REDDIT_SCRIPT_INDEX.md`, `../SOURCES.md`.  
Reddit primary insight: k8powers on watermark / Scenechronize (why full series PDFs never leaked).

This file stores **self-written craft observations**, not dialogue dumps.

---

## Global writers-room rules (product-usable)

1. **Corner the character** before inventing a clever plot move.  
   Ask: given who they are and what they know, what is the only move left?
2. **Agenda collision** drives scenes, not exposition.  
   Each present character wants something incompatible in the same room.
3. **Action lines set tone** (Gilligan via Goldman): readable, not dry slug-line bureaucracy.  
   Our Story Director should describe pressure, not inventory furniture.
4. **Half measures vs full measures** is the moral grammar of the cast.  
   Mike's discipline vs Walt's ego is the central engine after S3.
5. **Knowledge is not shared by default.**  
   Who was in the room / who saw the body / who holds the ledger matters more than "what happened in the series".

---

## Episode craft cards (minimum set)

### 1x01 Pilot

Studied from production PDF (local /tmp only; not committed): Vince Gilligan 5/27/05 draft.

- **Spatial grammar**: cow pasture teaser → White house domestic → high school classroom → car wash humiliation → medical diagnosis → Jesse bungalow → RV cook → back to kitchen/garage/bedroom. Domains of self alternate until they contaminate each other.
- **Room problem**: Walt's life is small; cancer makes the cost of smallness visible; first crime is competence theater under panic.
- **Walt**: humiliation → competence fantasy → first irreversible step while still wearing underpants-and-gas-mask absurdity (pride before dignity).
- **Jesse**: street competence, classroom residue; not yet tragic.
- **Shared room start**: almost empty. Family does not know. DEA does not know.
- **Agent takeaway**: early Walt still needs permission structures (school, family, "for them"); action description should feel readable and tense, not inventory-like.
- **Continuity seed**: diagnosis private; partnership secret; Gray Matter wound active offstage.

### 1x04 Gray Matter (when available)

- **Room problem**: reunion with old success exposes Walt's pride wound.
- **Walt**: rejects charity; humiliation is worse than danger.
- **Agent takeaway**: Gray Matter is not backstory trivia; it is the wound that rewrites every "for family" speech.

### 3x10 Fly

- **Room problem**: one fly = contamination of control.
- **Walt**: obsesses over purity / error / guilt displacement.
- **Jesse**: wants sleep, money, normalcy; becomes caretaker against his will.
- **Shared room**: superlab as pressure cooker; almost no external cast.
- **Agent takeaway**: Walt/Jesse scenes work when Walt's control ritual collides with Jesse's exhausted humanity.

### 3x12 Half Measures

- **Room problem**: how far do you go when a threat is personal?
- **Mike**: experience says incomplete force creates more bodies later.
- **Walt**: ego chooses the dramatic completion.
- **Agent takeaway**: Mike speaks in consequences; Walt speaks in justifications. Do not swap their mouths.

### 3x13 Full Measure

- **Room problem**: partnership cost becomes body count.
- **Walt**: will sacrifice the partner's moral line to keep the system running.
- **Jesse**: loyalty used as a weapon against him.
- **Agent takeaway**: after this beat, Jesse's trust ledger never resets to zero with Walt.

### 5x14 Ozymandias / 5x16 Felina

- **Room problem**: empire end-state; secrets detonate into public family reality.
- **Walt**: late arc can admit motive ("for me") but still scripts final control.
- **Skyler / family**: no longer "don't know"; Continuity Board must flip.
- **Agent takeaway**: era lock is mandatory. Late-series knowledge cannot leak into early-series sessions.

---

## Speech craft (cross-cast)

| Character | Under pressure | Never does |
|-----------|----------------|------------|
| Walter | Becomes more precise, then declarative | Casual confession without leverage |
| Jesse | Fragments, moral noise, then raw honesty | Calm multi-step strategy first |
| Skyler | Quieter, more specific questions | Cute domestic fluff when stakes are money/safety |
| Saul | Options menu + jokes, then survival specifics | Brave martyrdom |
| Mike | Fewer words, ordered next actions | Therapy language |
| Gus | More formal, hospitality as cage | Loud rage monologues |

---

## What we deliberately do not store

- Full teleplay text  
- Subtitle / transcript dumps  
- "Complete quote packs" per character  

Derived artifacts go to:

- `../agents/*.md` role cards  
- `../CONTINUITY_BOARD.md` shared truth schema  
- backend `agents/characters/*.py` system prompts


## Walt-Jesse pair craft (product-usable)

Analysis only. No dialogue dumps. Goal: free alternate plots that still feel brilliant.

### Shared-room engine

1. Walt wants control restored and competence recognized.
2. Jesse wants not to be disposable and not to become the moral dump site.
3. The scene is usually their collision, not a logistics meeting.

### Who may know what (default s3_mid)

| Fact class | Walt | Jesse | Skyler |
| --- | --- | --- | --- |
| Gus roof / org standards | yes | yes | no |
| Household money story incomplete | yes | no (unless board grants) | yes |
| Jesse already spent as violence tool | yes | yes (body-level) | no |
| Mike's half-measures judgment | yes | partial | no |

### Free-play rules

- Player may rewrite premise (they never cooked; they are equals; Jesse is in charge).
- Once rewritten, later lines continue from the new premise + whatever was already said.
- Do not "correct" free play back to canon plot beats. Keep the power-and-conscience texture unless the player killed that too.

### Speech pressure (not catchphrases)

- Walt under pushback: shorter, more exact, moral self-justification.
- Jesse under pushback: fragments, restarts, moral interrupt, then either fold or blow.
- Neither should paste famous monologues.

### Continuity Board hooks

- Prefer open tension `approval_vs_use` whenever both are present.
- After a beat where Jesse is ordered into risk, mark an irreversible cost if blood/exposure actually lands on the board.

