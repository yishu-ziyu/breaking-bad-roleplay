# Plan — Phase 2: Deploy (revise #3)

## Architecture

One Railway service: FastAPI backend serves built Vite frontend via
StaticFiles. Nixpacks auto-detects Node (package.json) and Python
(backend/pyproject.toml).

## Changes

### 1. `.gitignore` — ignore .env at all levels

Current: only `*.local` is ignored.
Fix: add `.env` and `**/.env` to cover both root and `backend/.env`.

Verify: `git ls-files backend/.env` returns nothing (untracked).

### 2. `backend/config.py` — add ALLOWED_ORIGINS

Add `allowed_origins: str = ""` field. Empty string means "not configured".
In production, MUST be set explicitly — no wildcard fallback with
`allow_credentials=True`.

### 3. `backend/main.py` — CORS + serve frontend + DB init

**CORS fix**: Parse `settings.allowed_origins` as comma-separated list.
Empty string → empty list (blocks all CORS in prod). `"*"` → `["*"]` (dev only).

**StaticFiles mount**: Mount `dist/` AFTER API routes are registered.
Ensures `/api/*` matches the router before the catch-all static mount.

**DB init**: Add `create_all` to lifespan startup. MUST import `db.models`
before calling `create_all` so model classes register with the Base metadata.
```python
from db.models import Base  # registers models
from db.session import engine
# then: Base.metadata.create_all(engine)
```

### 4. `vite.config.ts` — production base

Add `base: './'` so asset paths work when served from a subpath.

### 5. `railway.toml`

```toml
[build]
builder = "RAILPACK"

[deploy]
startCommand = "cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT"
```

Railpack is Railway's native builder that handles multi-language builds.
Explicit `builder = "RAILPACK"` ensures Node + Python both build.

### 6. `.env.production.example`

Document required env vars:
- `MINIMAX_API_KEY`
- `STEPFUN_API_KEY`
- `DATABASE_URL` (auto from Railway PostgreSQL addon)
- `SECRET_KEY`
- `APP_ENV=production`
- `ALLOWED_ORIGINS` (REQUIRED in prod — Railway URL, no default)

## What we won't do

- Dockerfile (Railpack handles it)
- Alembic migrations (create_all for MVP)
- Custom domain

## Verification

- `npm run build` exits 0
- `cd backend && uv run pytest` passes
- Railway deploy succeeds
- Public URL returns the app (human checkpoint)
