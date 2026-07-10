# Agent Playtest Process

Use this process for gameplay, story, character voice, GIF, UI flow, or retention changes.
Skip it for pure dependency bumps, formatting, deployment plumbing, or one-line bug fixes.

## Lanes

| Lane | Owner | Writes? | Output |
| --- | --- | --- | --- |
| Lead orchestrator | Main agent | Integration only | Plan, dispatch, fan-in, acceptance, next slice. |
| Implementer | Parallel agent | Yes, disjoint scope | Concrete code/doc/test slice with checks. |
| Code reviewer | Parallel agent | No by default | `REQUEST_CHANGES`, `COMMENT`, or `APPROVE` with findings first. |
| BB player | Parallel agent | No | Playtest mismatches from a knowledgeable Breaking Bad fan perspective. |

No two agents edit the same files. Reviewer and player lanes are evidence lanes unless the lead explicitly assigns a disjoint write scope.

## Delegation Default

The lead preserves context for coordination. Dispatch concrete detail work when it is bounded and not the next blocking decision:

- codebase mapping, file tracing, and caller searches;
- isolated code/doc/test edits with a clear write scope;
- test failure triage in separate subsystems;
- browser or playtest passes;
- code review, spec review, and BB-player critique.

Keep work local only when it is tiny, tightly coupled, security-sensitive, or the immediate blocking decision.

## Cycle

1. Reuse or write a brief with user-visible acceptance criteria.
2. Lead slices work into independent scopes and dispatches concrete detail tasks first.
3. Lead integrates returned work, resolves conflicts, and runs the normal checks.
4. Spawn reviewer and BB player lanes in parallel.
5. Lead continues only non-overlapping verification while they run.
6. Fan in findings as `fix now`, `record for next loop`, or `reject`.
7. Fix only `fix now`, rerun checks, and update `DEVLOG.md` or the loop artifact.

## Reviewer Contract

Input packet:

- Task id, goal, brief, acceptance criteria, implementer summary, `git diff --stat`, relevant diff, checks already run, and dirty-tree note.

Output packet:

- Verdict, scope table, findings with file refs, at most five next actions, rerun checks, and carry-over items.

## BB Player Contract

Persona:

- A skeptical Breaking Bad fan who judges immersion, not trivia.

Representative paths:

- Walter as `former student` or `lab partner`.
- Jesse as `partner` or `person he disappointed`.
- Gus as `employee`, `supplier`, or `person being evaluated`.
- One Crew scene and one Story scene when the change touches those modes.

Checklist:

- Character voice matches the selected role and relationship.
- Relationship anchor changes power dynamics, not just labels.
- Story mode creates tension without spoiling the whole arc.
- GIFs are role-local and support emotional beats.
- Language setting controls new model output.
- Safety refusals stay in character and redirect to drama/consequences.

Finding format:

```text
Role / Mode:
Relation:
Language:
Turn Prompt:
Observed Reply Summary:
Expected BB Feel:
Mismatch:
Severity: P0 / P1 / P2
Category: character | tension | language | gif | relation | safety
Evidence:
Suggested Fix Direction:
```

Do not automate canon feel into hard tests. Use human/agent judgment for immersion; only convert stable regressions into tests.
