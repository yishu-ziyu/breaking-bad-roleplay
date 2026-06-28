from contextlib import asynccontextmanager
from pathlib import Path
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from api.routes import router as api_router
from db.models import Base  # noqa: F401 — registers models with Base.metadata
from db.session import engine

# Configure logging before any application module uses a logger.
# Without this, Python's lastResort handler emits bare WARNING+ messages
# to stderr with no timestamp, module name, or level control.
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create DB tables (MVP — replace with Alembic later)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Initialise singletons so they share a single httpx client.
    from agents.provider import ProviderFacade
    from agents.director import DirectorAgent

    provider = ProviderFacade(settings)
    director = DirectorAgent(provider)

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
# "*" → allow all (development only).
_raw_origins = settings.allowed_origins.strip()
if _raw_origins == "*":
    allowed_origins = ["*"]
elif _raw_origins:
    allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
else:
    allowed_origins = []

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
