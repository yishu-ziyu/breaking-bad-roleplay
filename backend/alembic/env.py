"""Alembic migration environment.

Reads the database URL from the application's ``Settings`` (same source as
the runtime engine) and converts the asyncpg driver to psycopg2 because
Alembic runs migrations synchronously. ``target_metadata`` points at
``Base.metadata`` so ``alembic revision --autogenerate`` can diff the models.
"""
from logging.config import fileConfig

from sqlalchemy import create_engine, make_url, pool

from alembic import context

# Shared Base.metadata. Game tables live only in game.models — do not
# also declare them in db.models or autogenerate / create_all double-registers.
from config import settings
from db.session import Base
from db.url import render_engine_url
import db.models  # noqa: F401 — sessions, messages, quota, …
import game.models  # noqa: F401 — game_runs / actions / events / checkpoints / jobs

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _sync_url():
    """Return a sync-compatible database URL derived from settings.

    ``settings.database_url`` uses ``postgresql+asyncpg`` for the async
    engine. Alembic is synchronous, so swap the driver to ``psycopg2``.
    Other backends (e.g. sqlite used by some tests) are returned as-is.
    """
    url = make_url(settings.database_url)
    if url.get_backend_name() == "postgresql" and "+asyncpg" in url.drivername:
        url = url.set(drivername="postgresql+psycopg2")
    return url


# One metadata object; both import lines above register onto it once.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Emits SQL to stdout without needing a live DB connection.
    """
    url = render_engine_url(_sync_url())
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    Creates a synchronous Engine and runs migrations within a transaction.
    """
    engine = create_engine(_sync_url(), poolclass=pool.NullPool)

    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
