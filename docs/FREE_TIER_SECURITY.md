# Free tier + platform key security

Last updated: 2026-07-13

## Threat model

Attackers must not:

1. Extract platform MiniMax / StepFun keys from the browser or API responses.
2. Burn unlimited platform spend by scripting chat / story / TTS.
3. Multiply free pools by rotating fake identities without friction.

## Controls (shipped)

| Control | How |
|---------|-----|
| Keys stay server-side | Only booleans in `/api/connections/catalog`; keys never in JSON responses |
| BYOK keys | Browser AES-GCM vault + RAM bind token only; never written to DB |
| Free credits | Server meter: chat 1 / crew 2 / story beat 5 / tts 1 |
| Guest identity | UUID in `X-Guest-Id` or SSE `guest_id` query; scoped with IP hash |
| Daily guest cap | Default **8** credits (`FREE_CREDITS_GUEST`) |
| Daily logged-in cap | Default **80** credits (`FREE_CREDITS_USER`) - early-access welfare per Supabase user |
| Auth proof | Supabase access token via `Authorization: Bearer` (or SSE `access_token` query); server calls `/auth/v1/user` |
| Site daily budget | Default **5000** credits (`PLATFORM_DAILY_CREDIT_BUDGET`) shared across all free traffic |
| IP rate limit | Default **40** billable ops / rolling hour (`PLATFORM_RATE_LIMIT_PER_HOUR`) |
| BYOK escape | Valid bind session skips free meter (user pays provider) |

## Config (env)

```text
FREE_CREDITS_GUEST=8
FREE_CREDITS_USER=80
PLATFORM_DAILY_CREDIT_BUDGET=5000
PLATFORM_RATE_LIMIT_PER_HOUR=40
QUOTA_IP_SALT=abq-quota-v1
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...   # same publishable/anon key as frontend
```

## Known limits

- In-process counters: fine for single Docker VM; multi-instance (Vercel) does not share memory across lambdas. Prefer one primary host for platform demo, or later move counters to Redis/Postgres.
- Guest UUID is not a secret; IP rate limit is the burst shield against rotation.
- Client UI remaining is advisory; only server 402/429 is authoritative.

## Operator checklist

1. Never put API keys in `VITE_*` frontend env.
2. Rotate keys if they ever appear in chat logs or client bundles.
3. Watch MiniMax/StepFun dashboards for spend spikes.
4. On abuse: lower `PLATFORM_DAILY_CREDIT_BUDGET` or `PLATFORM_RATE_LIMIT_PER_HOUR` and redeploy.
