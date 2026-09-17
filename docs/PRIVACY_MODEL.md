# ABQ Roleplay Lab Privacy Model

Last updated: 2026-09-17

This document describes what the project currently protects, what it does not protect, and which rules future development must preserve.

## Current Promise

The application protects cloud profile data from other users through Supabase RLS, and it now stores chat history and character memory in Supabase as client-encrypted ciphertext.

The product can say:

- Other users cannot read or write your profile rows.
- Cloud-saved chat turns and character memory are encrypted before they are stored in Supabase.
- Production logs must not contain raw user messages, memory summaries, key facts, full prompts, or model responses.
- Local guest progress stays on the user's device unless they sync a profile.
- Story sessions require a per-session ownership key at the FastAPI boundary;
  backend-owned PostgreSQL tables have RLS enabled with no browser-facing
  anon/authenticated policy.

The product must not say:

- Developers can never see anything the user types.
- The backend never processes plaintext.
- This is a complete zero-knowledge system.

The reason is simple: the AI chat path still sends the current turn, recent history, and memory context to `/api/chat` so the model can respond. The backend should treat that plaintext as transient request data: process it, do not log it, do not persist it.

## Protection Layers

### User-to-User Isolation

Supabase tables are protected with RLS:

- `chat_messages`
- `character_memory`
- `story_sessions`

Policy shape:

```sql
auth.uid() = user_id
```

This was verified against the live Supabase project with `npm run verify:rls`:

- User A can read/write their own rows.
- User B cannot read User A rows.
- User B cannot insert rows while spoofing User A's `user_id`.
- Anonymous clients cannot read the rows.

The FastAPI Story/game/quota schema is a separate server-owned surface. Its
tables (`sessions`, `messages`, `character_states`, `character_dossiers`,
`story_turns`, BYOK/quota audit tables, and game-kernel tables) enable
PostgreSQL RLS **without** PostgREST policies. Browser access must go through
FastAPI, which checks the Story session key or the relevant API ownership rule.
The backend migration role owns these tables and therefore retains access;
do not switch production to a non-owner DB role without adding and testing a
server-role policy first.

### Developer Visibility

RLS does not protect data from someone holding service role or database admin access. Supabase service role keys bypass RLS. Treat them as production root credentials.

Operational rule:

- Do not paste service role keys in chat.
- Do not commit `.env.rls.local`, `.env.local`, or backend env files.
- Rotate any service role key that has appeared in chat, logs, screenshots, or a shared document.
- Keep Dashboard and service role access limited and temporary.

### Cloud At-Rest Encryption

New cloud chat and memory writes go through [src/lib/privacyVault.ts](../src/lib/privacyVault.ts).

Mechanism:

- On email/password sign-in or sign-up, the browser derives an AES-GCM key from the user's login password.
- The derived key is stored in local browser storage for session restoration on the same device.
- `chat_messages.message` stores an `abqenc:v1:` envelope instead of plaintext for new writes.
- `character_memory.summary` stores an `abqenc:v1:` envelope.
- `character_memory.key_facts` stores a one-item JSONB encrypted envelope wrapper.
- Older plaintext rows are still readable for backward compatibility.

Tradeoff:

- A new device can decrypt cloud history after the user signs in with the password, because the same password-derived key can be recreated.
- If a password changes, old encrypted rows may require a migration/re-encryption path. That path is not implemented yet.
- If a session exists but the local privacy key is missing, cloud sync is locked and the UI asks the user to sign in again.

### Logging Red Line

Production code must not log:

- raw `userInput`
- chat `history`
- memory summaries
- key facts
- model `reply_text`
- crew `debate_logs`
- full provider request payloads
- full provider responses
- access tokens, refresh tokens, service role keys, or API keys

Allowed logging:

- request id
- hashed or internal user id only when necessary
- character id
- route name
- latency
- provider name
- status code
- generic error category

Guardrail:

- [tests/privacy-guard.spec.ts](../tests/privacy-guard.spec.ts) statically checks that the backend route and provider transport do not log sensitive payload fields.

## Current Data Map

| Surface | Storage | Privacy posture |
|---|---|---|
| Guest chat | browser localStorage | local to device, plaintext on that device |
| Logged-in cloud chat | Supabase `chat_messages.message` | client-encrypted for new writes |
| Character memory | Supabase `character_memory` | client-encrypted for new writes |
| Story session metadata/world | FastAPI `sessions` | server plaintext, session-key protected, RLS blocks direct Data API reads |
| Story commands/events | FastAPI `story_turns` | server plaintext; payload, effects, snapshots and public outbox are not client-encrypted |
| Story dialogue | FastAPI `messages` | server plaintext, session-key protected at API, direct Data API blocked by RLS |
| Game kernel / quota / BYOK audit metadata | backend database | server-only tables with RLS; BYOK secret keys themselves are not persisted here |
| Current `/api/chat` request | backend process memory | transient plaintext, must not be logged |
| LLM provider request | external model provider | plaintext sent for generation |

## Development Rules

When adding any feature that touches user text, memory, prompts, or model output:

1. Do not add raw body logging.
2. Do not persist cloud profile text outside the privacy vault.
3. Keep RLS tests and encryption tests passing.
4. If a new Supabase column stores user-authored text, either encrypt it or document why it is public/non-sensitive.
5. If a new backend table stores private story text, enable server-only RLS,
   add an ownership test, and update this data map before shipping it.
6. If debugging requires reading a user's content, use explicit user consent and avoid leaving copies in logs or screenshots.

## Known Gaps

- `story_sessions` in Supabase is RLS-protected but not currently used by the React Story path.
- FastAPI Story world, commands, events and dialogue are not client-encrypted.
  RLS and the session key prevent direct cross-user access; database operators
  and the LLM provider can still process/read the relevant plaintext.
- The backend and LLM provider necessarily process current request plaintext.
- No export/recovery UI exists for the privacy key.
- Password-change re-encryption is not implemented.
- Local browser storage is not encrypted against someone with access to the user's own device/browser profile.
