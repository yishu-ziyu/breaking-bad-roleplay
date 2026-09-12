# Delivery 2 — Deploy Config

## What changed

### `.gitignore`
- Added `.env` and `**/.env` to prevent accidental commit of secrets at any level.

### `backend/config.py`
- Added `allowed_origins: str = ""` field to Settings.

### `backend/main.py`
- CORS: parses `ALLOWED_ORIGINS` from env as comma-separated list. Empty string → empty list (blocks all CORS in prod). `"*"` → `["*"]` (dev only).
- DB init: added `create_all` to lifespan startup with explicit `db.models` import before `create_all`.
- StaticFiles: mounts `dist/` after API routes are registered. Only in production mode.

### `vite.config.ts`
- No change needed (StaticFiles serves from root path, default `base: '/'` works).

### `railway.toml` (new)
- Builder: RAILPACK
- Start command: `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`

### `.env.production.example` (new)
- Documents all required env vars for Railway deployment.

## Verification

- `npm run build`: exit 0, 108ms
- `cd backend && uv run pytest`: 15 passed, 0.19s
- `dist/` directory exists with built assets

## Notes

- Railway PostgreSQL addon auto-provides `DATABASE_URL`
- `create_all` is MVP approach; replace with Alembic for production migrations
- ALLOWED_ORIGINS must be set in Railway Variables tab before first deploy
