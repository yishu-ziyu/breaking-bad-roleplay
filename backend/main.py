from contextlib import asynccontextmanager
from pathlib import Path
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from api.routes import router as api_router
from db.models import Base  # noqa: F401 — registers models with Base.metadata

# Configure logging before any application module uses a logger.
# Without this, Python's lastResort handler emits bare WARNING+ messages
# to stderr with no timestamp, module name, or level control.
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


def _enforce_runtime_invariants() -> None:
    """P3 (full-stack review): make the single-worker invariant explicit.

    BYOK API keys live in the process-RAM connection store by design (they
    are never persisted). With Redis also absent, that only works while one
    uvicorn process serves all traffic: a second worker cannot see worker
    A's bindings, and players would loop on binding_expired rebinds. Rather
    than let that degrade silently, refuse to start. Scale out safely by
    setting REDIS_URL (shared rate limiting) — and revisit the key store
    before multi-worker becomes a real requirement.

    Quota counters no longer depend on this (durable DB tier since P3).
    """
    import os

    raw = os.environ.get("WEB_CONCURRENCY", "1")
    try:
        workers = int(raw)
    except ValueError:
        workers = 1
    redis_configured = bool((getattr(settings, "redis_url", "") or "").strip())
    if workers > 1 and not redis_configured:
        raise RuntimeError(
            "Refusing to start: WEB_CONCURRENCY=%s without REDIS_URL. "
            "BYOK key bindings are per-process RAM; multiple workers would "
            "lose them silently. Set REDIS_URL (required for shared rate "
            "limits) before scaling out, or run a single worker."
            % workers
        )
    if workers <= 1:
        logger.info(
            "runtime invariants OK: single worker, quota tier=%s",
            "redis" if redis_configured else "postgres-durable",
        )


def _parse_allowed_origins(raw: str, app_env: str) -> list[str]:
    """Parse the ALLOWED_ORIGINS env var into a list of CORS origins.

    Rules:
    - ``"*"`` → ``["*"]`` (allow all; development only).
    - comma-separated list → trimmed list of origins.
    - empty string → ``[]`` (no origins allowed; production default).

    In production with empty origins, logs a WARNING so the misconfiguration
    is visible in logs instead of manifesting as mysterious CORS 403s on the
    frontend. The default is intentionally NOT ``"*"`` in production — that
    would weaken CORS security.
    """
    raw = raw.strip()
    if raw == "*":
        return ["*"]
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    # empty
    if app_env == "production":
        logger.warning(
            "ALLOWED_ORIGINS is empty in production — all browser CORS "
            "requests will be rejected. Set ALLOWED_ORIGINS to a "
            "comma-separated list of allowed origins "
            "(e.g. https://your-app.example.com)."
        )
    return []


@asynccontextmanager
async def lifespan(app: FastAPI):
    # P3: fail fast on configurations that would silently corrupt billing
    # (multi-worker without Redis). See _enforce_runtime_invariants.
    _enforce_runtime_invariants()

    # Schema management is handled exclusively by Alembic. The app does NOT
    # create tables at startup — run `alembic upgrade head` before starting
    # the server (dev and prod alike). create_all was removed because it
    # only creates missing tables and never applies subsequent migrations,
    # which caused schema drift versus the Alembic history.
    logger.info(
        "DB schema must be initialised via `alembic upgrade head` before "
        "starting the app; startup no longer calls Base.metadata.create_all."
    )

    # Initialise singletons so they share a single httpx client.
    from agents.provider import ProviderFacade
    from agents.director import DirectorAgent

    provider = ProviderFacade(settings)
    director = DirectorAgent(
        provider,
        model_route=settings.director_model_route,
        enable_dossier_updates=settings.enable_dossier_updates,
    )

    app.state.provider = provider
    app.state.director = director

    yield

    await provider.close()


app = FastAPI(
    title="Breaking Bad Roleplay API",
    description="Backend for interactive Breaking Bad roleplay sessions",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS: parse ALLOWED_ORIGINS from env (comma-separated).
# Empty string → no origins allowed (production default).
# "*" → allow all (development only). A WARNING is logged in production
# when ALLOWED_ORIGINS is empty so the misconfiguration is visible — see
# _parse_allowed_origins for the full rules.
allowed_origins = _parse_allowed_origins(
    settings.allowed_origins, settings.app_env
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes first — they take precedence over the static catch-all.
app.include_router(api_router, prefix="/api")

# Serve built frontend in production.
if settings.app_env != "development":
    dist_path = Path(__file__).resolve().parent.parent / "dist"
    if dist_path.exists():
        app.mount("/", StaticFiles(directory=str(dist_path), html=True), name="frontend")
