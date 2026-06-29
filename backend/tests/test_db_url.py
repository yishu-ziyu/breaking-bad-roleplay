"""Database URL rendering tests."""

from sqlalchemy import make_url

from db.url import render_engine_url


def test_render_engine_url_preserves_password():
    url = make_url("postgresql://user:secret-password@example.com/db")

    assert str(url) == "postgresql://user:***@example.com/db"
    assert render_engine_url(url) == "postgresql://user:secret-password@example.com/db"


def test_render_engine_url_preserves_url_encoded_password():
    url = make_url("postgresql://user:p%40ss%2Fword@example.com/db")

    rendered = render_engine_url(url)

    assert "***" not in rendered
    assert rendered == "postgresql://user:p%40ss%2Fword@example.com/db"
