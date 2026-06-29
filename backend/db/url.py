"""Database URL helpers.

SQLAlchemy's URL.__str__ hides passwords as ``***``. That is useful for logs,
but fatal when passing a URL to an engine. Always render engine URLs with
``hide_password=False``.
"""

from __future__ import annotations

from sqlalchemy.engine import URL


def render_engine_url(url: URL) -> str:
    """Render a SQLAlchemy URL preserving the real password."""
    return url.render_as_string(hide_password=False)
