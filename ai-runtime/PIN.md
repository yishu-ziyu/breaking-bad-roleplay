# pi-agent version pin

Skill baseline: `pi-coding-agent` **v0.83.0**.
npm latest checked 2026-08-27: `@earendil-works/pi-coding-agent` **0.84.3**.

We pin **0.84.3** (exact, no `^` / no `latest`).

APIs used by this sidecar still exist after 0.83.0:

- `createAgentSession`
- `SessionManager.inMemory()`
- `DefaultResourceLoader({ systemPromptOverride, appendSystemPromptOverride })`
- `noTools: "builtin"`
- `defineTool` / `customTools`
- `session.subscribe` / `abort` / `dispose`
- `ModelRuntime.create({ credentials })` + `InMemoryCredentialStore` (no `~/.pi/agent/auth.json`)

0.84.0 streaming change: `message_update` is delta-only. This runtime assembles text from `text_delta` and treats `agent_settled` + prompt `finally` as done. Thinking deltas are dropped.

Old `@mariozechner/*` packages are deprecated; new scope is `@earendil-works/*`.

Node: 0.84.3 requires `>=22.19.0`. This sidecar declares the same `engines` field.
