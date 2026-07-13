# Friends early-access - 10 人试玩与账户管理

## What friends get after login

| Tier | Daily free credits | Story beats (5 each) | How identity works |
|------|--------------------:|----------------------:|--------------------|
| Guest | 8 | ~1 beat | `guest_id` + IP hash |
| **Logged-in** | **80** | **~16 beats** | Supabase `user_id` |
| BYOK | unlimited on our meter | unlimited | their own API key |

Login is **not** cosmetic: the server verifies the Supabase access token and meters a **separate pool per account**.

## Can 10 friends all play?

**Yes, if three budgets hold:**

1. **Per-user 80** - each account has its own 80/day. Friends do not steal each other's personal pool.
2. **Site daily 5000** (`PLATFORM_DAILY_CREDIT_BUDGET`) - all free-tier spend (guest + logged-in) shares this.
   - 10 friends x 80 = **800**/day max if everyone maxes out. Comfortable under 5000.
   - If you invite 100 people who all burn 80, you hit the site cap (8000 > 5000) and later users get 429.
3. **IP rate limit 40/hour** - friends on the **same Wi-Fi / office NAT** share one IP.
   - 40 billable ops/hour from one IP (chat, beat, tts each count).
   - Ten people in one room hammering Continue can hit 429 even with credits left.
   - Raise `PLATFORM_RATE_LIMIT_PER_HOUR` for a private demo night if needed.

**Provider side (MiniMax / StepFun):** free credits only gate *your* platform keys. If MiniMax returns 402, story fails even with free credits remaining. Watch provider dashboards when friends pile on.

## How to manage their accounts

You do **not** need a custom admin panel for early access. Use Supabase Auth:

1. **Supabase Dashboard → Authentication → Users**
   - See who signed up (email, created_at, last sign-in).
   - Disable / ban a user if abuse.
   - Delete user if needed (their free pool id disappears with the user id).

2. **Sign-up policy**
   - Keep email+password (current).
   - For a closed circle: disable open sign-ups in Supabase and invite only, **or** leave open and ban abusers.
   - Optional later: allowlist table of emails that get the 80-credit tier.

3. **What you can tell friends**
   - Register / log in on https://bb.yishuziyu.cn
   - See 「登录福利 80」in the quota pill (not guest 8).
   - Each story beat costs 5; ~16 beats/day; resets UTC midnight.
   - If they need more, connect their own key (BYOK) in 引擎线路.

4. **What you watch as operator**
   - MiniMax / StepFun usage and billing.
   - Site budget: if `globalRemaining` in `/api/quota` collapses, raise budget or ask people to BYOK.
   - Server logs: `402` free exhausted, `429` rate/global, provider 402 fallbacks.

5. **Env knobs (VM `.env.runtime`)**

```text
FREE_CREDITS_GUEST=8
FREE_CREDITS_USER=80
PLATFORM_DAILY_CREDIT_BUDGET=5000
PLATFORM_RATE_LIMIT_PER_HOUR=40
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

Rebuild `bb-roleplay` after env changes.

## Security notes

- Free tier still never exposes platform keys.
- SSE must pass `access_token` in the query (EventSource cannot set headers). Prefer HTTPS only; avoid logging full query strings in public access logs if possible.
- Guest UUID alone is not enough to claim the 80 pool; only a **valid Supabase session** is.
