"""Database URL helpers.

SQLAlchemy's URL.__str__ hides passwords as ``***``. That is useful for logs,
but fatal when passing a URL to an engine. Always render engine URLs with
``hide_password=False``.

Also decode percent-encoded characters in the password so the URL is safe
to pass to Python's configparser (which treats ``%`` as interpolation syntax).
"""
from __future__ import annotations

from sqlalchemy.engine import URL
from urllib.parse import unquote


def render_engine_url(url: URL) -> str:
    """Render a SQLAlchemy URL preserving the real password.

    Percent-encoded characters in the password (e.g. ``%40`` for ``@``)
    are decoded so the resulting string is safe for configparser.
    """
    password = url.password or ""
    decoded_password = unquote(password)
    if decoded_password != password:
        url = url.set(password=decoded_password)
    return url.render_as_string(hide_password=False)
