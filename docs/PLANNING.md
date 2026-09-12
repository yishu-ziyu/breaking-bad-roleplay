# Planning docs are not product constraints

Historical `.ship` loops, briefs, scorecards, growth plans, roadmaps, and “下一轮” queues are **reference only**. They do not constrain what to build next.

Direction can be redone. Do not treat archived loop artifacts as specs.

## What still binds

- Live as-built behavior (characters, Direct / Crew / Story, McKee as shipped)
- Safety: fictional drama only; no real-world crime, chemistry, violence, or evasion how-to
- Ops that keep the site running: [OPS_RUNBOOK.md](OPS_RUNBOOK.md)
- ADRs that describe what already shipped: DEC-0001, DEC-0002, DEC-0003, DEC-0005, DEC-0006
- Tests, code, and prompts that implement shipped behavior

## Archive

Moved planning files live under [archive/plans/](archive/plans/). Old entry points (`.ship/`, `docs/specs/`, `looper-output/`, `tasks/`, `.trae/specs/`) point here.

`.ship/` is gitignored for local loop artifacts; the tracked pm-state snapshot is in the archive.
