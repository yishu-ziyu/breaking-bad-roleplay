# Render Deployment Guide — ABQ Roleplay Lab

This guide deploys the full FastAPI + React + PostgreSQL version of ABQ Roleplay Lab.

## Recommended architecture

```text
Browser
  -> Render Web Service (Docker)
      -> FastAPI /api/*
      -> React dist/ static frontend
      -> Render PostgreSQL
      -> StepFun and/or MiniMax LLM API
```

Use this path for the public version because Story mode depends on FastAPI, SSE, PostgreSQL, Alembic migrations, and long-running backend state.

## Prerequisites

- GitHub repository access.
- Render account.
- At least one LLM API key:
  - `STEPFUN_API_KEY` recommended for the current backend default route.
  - `MINIMAX_API_KEY` optional if MiniMax routing is enabled/used.

## Files involved

- `Dockerfile` — multi-stage production build:
  - Node stage runs `npm ci` and `npm run build`.
  - Python stage installs backend dependencies and copies built `dist/`.
  - Startup command runs `alembic upgrade head` before `python3 start.py`.
- `render.yaml` — creates one Render PostgreSQL database and one Docker web service.
- `backend/alembic/` — production database migrations.
- `backend/main.py` — serves `/api/*` routes and, in production, serves the React `dist/` bundle.

## Deployment steps

### 1. Push the latest main branch

```bash
git status
npm run build
cd backend && env -u PYTHONPATH -u VIRTUAL_ENV uv run pytest
cd ..
git push origin main
```

### 2. Create a Render Blueprint

1. Open Render Dashboard.
2. Click **New +**.
3. Choose **Blueprint**.
4. Select the GitHub repo `yishu-ziyu/breaking-bad-roleplay`.
5. Render reads `render.yaml` and creates:
   - `abq-roleplay-db` PostgreSQL database.
   - `abq-roleplay-lab` Docker web service.

### 3. Configure environment variables

In the Render web service environment tab, set:

```text
APP_ENV=production
LOG_LEVEL=INFO
ALLOWED_ORIGINS=https://<your-render-service>.onrender.com
STEPFUN_API_KEY=<your-stepfun-api-key>
MINIMAX_API_KEY=<your-minimax-api-key-or-empty>
```

`DATABASE_URL` is injected automatically by `render.yaml` from the Render PostgreSQL database.

Notes:

- The backend accepts Render's normal `postgresql://...` URL and converts it to `postgresql+asyncpg://...` internally.
- For a first test deploy, `ALLOWED_ORIGINS=*` can be used temporarily. Replace it with the exact Render/custom domain before public launch.
- At least one of `STEPFUN_API_KEY` or `MINIMAX_API_KEY` must be set.

### 4. Deploy

Trigger the first deploy from Render.

Expected startup sequence:

```text
npm ci
npm run build
pip install -r requirements.txt
cd /app/backend && alembic upgrade head
python3 start.py
```

### 5. Verify production

Health check:

```bash
curl https://<your-render-service>.onrender.com/api/health
```

Expected:

```json
{"status":"ok","service":"breaking-bad-roleplay"}
```

Open:

```text
https://<your-render-service>.onrender.com/
```

Manual smoke test:

1. Click **无需登录，先试试**.
2. Select Walter.
3. Use direct chat mode.
4. Send a short message.
5. Confirm an in-character reply appears.
6. Switch to Crew mode and confirm multiple characters can reply.
7. Try Story mode last, because it exercises SSE + DB + LLM orchestration.

## Public-launch checklist

Before sharing widely:

- Set exact `ALLOWED_ORIGINS`, not `*`.
- Add authentication or at least a demo access gate.
- Add rate limiting / cost controls for LLM endpoints.
- Cap Story mode beat count and token usage.
- Monitor Render logs during first public tests.

## Known caveats

- Running `alembic upgrade head` at container startup is appropriate for the single-instance Render service in `render.yaml`. Revisit this if deploying multiple replicas.
- Existing databases created by the old `create_all` path may need manual Alembic stamping or a clean reset. Fresh Render PostgreSQL databases should migrate normally.
- Docker build must run in an environment with the Docker daemon available. Local validation may fail if Docker Desktop is not running.
