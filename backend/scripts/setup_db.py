#!/usr/bin/env python3
"""
setup_db.py — create all database tables using SQLAlchemy async create_all.

Reads DATABASE_URL from the project .env (via config.py) and issues
CREATE TABLE IF NOT EXISTS for every model declared in db/models.py.

Usage:
    cd /Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay/backend
    python scripts/setup_db.py
"""

from __future__ import annotations

import asyncio
import sys

from config import settings
from db.models import Base
from db.session import engine


async def create_tables() -> None:
    """Run async CREATE TABLE for all declared models."""
    db_url = settings.database_url
    print(f"[setup_db] DATABASE_URL={db_url}")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    tables = sorted(Base.metadata.tables.keys())
    print(f"[setup_db] Created/verified {len(tables)} table(s): {', '.join(tables)}")


def main() -> int:
    try:
        asyncio.run(create_tables())
    except Exception as exc:
        print(f"[setup_db] FAILED: {exc}", file=sys.stderr)
        return 1
    print("[setup_db] Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
