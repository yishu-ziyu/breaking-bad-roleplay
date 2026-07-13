# BYOK + Provider Branding Spec

Last updated: 2026-07-13

Status: approved for implementation (one-shot).

This document is the single source of truth for:

1. Provider branding (how MiniMax / StepFun / CLIProxy appear)
2. Bring-Your-Own-Key (BYOK) credential lifecycle
3. Trust model and security rules
4. API + frontend execution plan

Related:

- [PRIVACY_MODEL.md](./PRIVACY_MODEL.md) - cloud chat encryption; BYOK is additive
- `backend/agents/provider.py` - LLM routing
- `backend/agents/tts.py` - MiniMax speech

---

## 1. Product decisions (locked)

| Decision | Choice | Why |
|----------|--------|-----|
| Trust model | **Hybrid: Platform demo + Client vault + Server RAM bind** | SSE cannot set custom headers; keys must not live in query strings long-term as raw secrets |
| Server persistence of user keys | **Never on disk / DB** | Stronger privacy claim; keys only in browser vault + short-lived RAM bind |
| Client persistence | **AES-GCM encrypted localStorage** | Survives refresh; not plain JSON |
| MiniMax LLM vs TTS keys | **Separate slots** | Real-world keys often differ (Token Plan vs Speech secret) |
| MiniMax region | **CN default (`api.minimaxi.com`), Global optional** | Already verified on this project |
| Entry UI | **Connection chip + sheet** (replace bare `<select>`) | Branding + status, not debug dropdown |
| No key behavior | **Platform mode if env keys exist; else block start with sheet** | Demo still works; pure BYOK also works |
| Logged-in vs guest vault | **Same device vault for both in v1** | Avoid blocking on full KMS; login privacy key may re-wrap later |

### Modes

```
platform  - use server env keys (MINIMAX_API_KEY / STEPFUN_API_KEY / CLI_PROXY_*)
byok      - use user-supplied credentials via bind session
```

Active connection always has:

```ts
{
  mode: 'platform' | 'byok'
  providerId: 'minimax' | 'stepfun' | 'cliproxy'
  modelId: string
  status: 'empty' | 'saved' | 'valid' | 'invalid' | 'quota' | 'unreachable'
  hint?: string          // masked …xxxx
  connectionSessionId?: string  // server RAM bind token for SSE/chat/tts
}
```

---

## 2. Provider brand catalog (canonical)

Each provider is a **brand card**, not a raw option string.

| Field | minimax | stepfun | cliproxy |
|-------|---------|---------|----------|
| id | `minimax` | `stepfun` | `cliproxy` |
| displayName | MiniMax | StepFun | CLIProxy |
| productLine (default model label) | M3 | step-2-16k | local agent |
| defaultModel | `MiniMax-M3` | `step-2-16k` | from server `cli_proxy_default_model` |
| needsLlmKey | true | true | optional |
| needsTtsKey | true (speech) | false | false |
| needsBaseUrl | false (region picks host) | false | true |
| regions | `cn` \| `global` | - | - |
| keyHintLlm | `sk-` / `sk-cp-` | `sk-` / bearer | local |
| keyHintTts | Speech API secret | - | - |
| docsUrl | open platform | open platform | local docs |
| accentToken | yellow-ink | olive | slate |

### Display rules

- UI label for model line: `MiniMax · M3` (brand first, product second)
- Never show full API keys; only `…` + last 4 chars
- Status chip colors stay low-chroma (status > decoration)
- Think/speak paper skins stay independent of provider branding

---

## 3. Credential slots

```ts
type CredentialSlot =
  | 'minimax.llm'
  | 'minimax.tts'
  | 'stepfun.llm'
  | 'cliproxy.llm'      // optional
  | 'cliproxy.baseUrl'
```

Vault blob shape (encrypted at rest in localStorage):

```ts
type VaultBlob = {
  v: 1
  slots: Partial<Record<CredentialSlot, string>>
  meta: Partial<Record<CredentialSlot, {
    hint: string
    lastCheckedAt?: string
    lastStatus?: ConnectionStatus
  }>>
  active: {
    mode: 'platform' | 'byok'
    providerId: ProviderId
    modelId: string
    region?: 'cn' | 'global'
  }
}
```

Storage key: `abq_connection_vault_v1`

Encryption:

- Device-local AES-GCM key in `abq_connection_vault_device_key_v1` (non-extractable prefer; exportable base64 for restore on same origin)
- Future: re-wrap with privacyVault key when user is signed in

---

## 4. Trust + security rules

### Must

1. Never log raw keys, Authorization headers, or vault plaintext.
2. Never put raw keys in URLs, analytics, or error toasts.
3. Server bind store is **memory-only**, TTL default **1 hour**, sliding on use optional.
4. Bind token is opaque UUID; SSE query may carry **only** `connection_session=<uuid>`.
5. Test endpoint accepts key in JSON body once; does not persist.
6. Platform catalog endpoint returns booleans only (`hasPlatformMinimax: true`), never key material.
7. Clear vault + revoke bind on "清除密钥".

### Must not claim

- "We never process your key" - false; backend uses it transiently to call providers.
- "Zero-knowledge BYOK" - false under hybrid proxy model.

### May claim

- Keys are not written to the database.
- Browser vault is encrypted at rest on device.
- Server holds user keys only in RAM bind sessions with TTL.
- Users can clear keys anytime.

---

## 5. Backend API

### 5.1 `GET /api/connections/catalog`

Returns brand list + platform availability + default models.

```json
{
  "providers": [ /* brand cards without secrets */ ],
  "platform": {
    "minimax": true,
    "stepfun": false,
    "cliproxy": true
  },
  "defaults": {
    "providerId": "minimax",
    "modelId": "MiniMax-M3"
  }
}
```

### 5.2 `POST /api/connections/test`

Body:

```json
{
  "providerId": "minimax",
  "purpose": "llm" | "tts",
  "apiKey": "…",
  "baseUrl": "optional",
  "region": "cn" | "global",
  "modelId": "optional"
}
```

Response:

```json
{
  "ok": true,
  "status": "valid",
  "latencyMs": 420,
  "message": "Connected"
}
```

Map HTTP:

- 401/403 → `invalid`
- 402 → `quota`
- network → `unreachable`

### 5.3 `POST /api/connections/bind`

Creates RAM session for SSE/chat/tts.

Body: provider + keys + region + model (no platform secrets returned).

Response:

```json
{
  "connectionSessionId": "uuid",
  "expiresAt": "ISO-8601",
  "providerId": "minimax",
  "modelId": "MiniMax-M3",
  "hint": "…a1b2"
}
```

### 5.4 `DELETE /api/connections/bind/{id}`

Revoke early.

### 5.5 Existing endpoints accept bind

| Endpoint | How |
|----------|-----|
| `GET /session/{id}/stream` | query `connection_session=` |
| `POST /chat` | body `connectionSessionId` optional |
| `POST /tts` | body `connectionSessionId` optional |

Resolution order for keys:

1. Active bind session override (contextvar)
2. Platform env key
3. Fail with actionable 503 / 401

---

## 6. ProviderFacade changes

- Read keys/base URL via helpers that consult `credential_context` ContextVar.
- MiniMax base host from region: `cn` → `https://api.minimaxi.com`, `global` → `https://api.minimax.io`.
- TTS uses `minimax.tts` slot, falling back to `minimax.llm` only if tts empty (documented fallback).
- Do not mutate process-global keys for concurrent safety.

---

## 7. Frontend information architecture

```
[Connection chip]  MiniMax · M3 · 已连接 ▾
        │
        ▼
[Connection sheet]
  Tabs or list: MiniMax | StepFun | CLIProxy | 平台演示
  Per brand:
    - Model select (small)
    - Region (MiniMax advanced)
    - LLM key (password) + Test + Save
    - TTS key (MiniMax only)
    - Base URL (CLIProxy)
    - Status + last checked
    - Clear
  Footer trust line:
    "密钥仅保存在本机加密仓库；服务端只在内存会话中临时使用，不入库。"
```

Chip locations:

- Sidebar (when open)
- Story HUD metric (compact) when playing and sidebar collapsed

Replace the bare LLM `<select>` completely.

---

## 8. Copy (zh / en)

| Key | zh | en |
|-----|----|----|
| connectionTitle | 模型线路 | Model line |
| modePlatform | 平台演示 | Platform demo |
| modeByok | 我的密钥 | My keys |
| statusValid | 已连接 | Connected |
| statusEmpty | 未配置 | Not configured |
| statusInvalid | 密钥无效 | Invalid key |
| statusQuota | 额度不足 | Quota exceeded |
| statusUnreachable | 线路不可达 | Unreachable |
| fieldLlmKey | 对话密钥 | Chat API key |
| fieldTtsKey | 语音密钥 | Speech API key |
| fieldBaseUrl | 本地地址 | Local base URL |
| fieldRegion | 区域 | Region |
| regionCn | 国内站 | China |
| regionGlobal | 国际站 | Global |
| actionTest | 测试连接 | Test connection |
| actionSave | 保存 | Save |
| actionClear | 清除密钥 | Clear keys |
| actionBind | 用于本会话 | Use for this session |
| trustLine | 密钥加密保存在本机；服务端不入库，仅内存会话临时使用。 | Keys are encrypted on-device; the server never stores them on disk and only holds a short-lived RAM session. |
| getKey | 获取密钥 | Get API key |
| blockStart | 请先连接模型线路 | Connect a model line first |

---

## 9. Execution phases

### Phase A - Foundations (this PR)

1. Spec doc (this file)
2. Brand catalog shared types (frontend + catalog API)
3. Client vault (`connectionVault.ts`)
4. Backend credential context + bind store
5. `/catalog` `/test` `/bind` routes
6. Wire ProviderFacade + chat + stream + tts to bind
7. Connection chip + sheet UI; remove bare select
8. Tests: bind store unit; test endpoint mock; vault round-trip

### Phase B - Hardening (follow-up if time)

1. Sliding TTL + max sessions per IP
2. Re-wrap vault with privacyVault when signed in
3. Connection health poll
4. Per-error i18n map expansion
5. Optional OAuth-style provider authorize (OpenRouter pattern) - out of scope now

### Phase C - Ops

1. Update DEPLOY docs: platform keys optional when all users BYOK
2. Privacy model appendix for BYOK claims
3. Never commit vault or bind dumps

---

## 10. Acceptance criteria

1. User can open Connection sheet, paste MiniMax LLM key, test, save, see chip `已连接`.
2. User can set separate TTS key; speech uses TTS slot.
3. Story SSE works with BYOK via `connection_session` (no raw key in URL).
4. Chat and TTS respect the same bind session.
5. Platform mode still works when env keys present and user selects platform.
6. Clear keys removes vault slots and revokes bind.
7. No raw key in UI after save; only hint.
8. `tsc` and targeted pytest pass.

---

## 11. Non-goals (v1)

- Multi-user server-side encrypted vault (KMS)
- Billing / credit purchase inside the app
- OpenRouter / Anthropic / OpenAI as first-class brands (catalog is extensible later)
- Migrating historical plain env-only deployments automatically

---

## 12. File map (implementation)

| Area | Path |
|------|------|
| Spec | `docs/BYOK_BRANDING.md` |
| Brand types | `src/lib/providerBrands.ts` |
| Vault | `src/lib/connectionVault.ts` |
| Hook | `src/hooks/useConnection.ts` |
| UI | `src/components/ConnectionChip.tsx`, `ConnectionSheet.tsx` |
| Bind store | `backend/agents/connection_sessions.py` |
| Context | `backend/agents/credential_context.py` |
| Routes | `backend/api/routes.py` (+ catalog/test/bind) |
| Provider | `backend/agents/provider.py` |
| TTS route | `backend/api/routes.py` synthesize path |
| Stream/chat | query/body `connection_session` / `connectionSessionId` |
| Tests | `backend/tests/test_connections.py`, vault unit if feasible |

---

## 13. Implementation order (strict)

1. Backend context + bind store + catalog/test/bind
2. ProviderFacade key helpers + region base URL
3. Wire stream/chat/tts
4. Frontend vault + brands + hook
5. ConnectionSheet/Chip
6. App integration (remove select)
7. Tests + manual smoke
