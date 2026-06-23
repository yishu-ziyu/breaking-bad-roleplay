from sqlalchemy import make_url
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)
from sqlalchemy.orm import DeclarativeBase

from config import settings

_db_url = make_url(settings.database_url)
if _db_url.get_backend_name() == "postgresql" and "+asyncpg" not in _db_url.drivername:
    _db_url = _db_url.set(drivername="postgresql+asyncpg")

engine = create_async_engine(
    str(_db_url),
    echo=settings.app_env == "development",
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
