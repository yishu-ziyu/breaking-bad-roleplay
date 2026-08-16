"""Session capability-key helpers."""

from __future__ import annotations

from agents.session_guard import (
    extract_session_key,
    hash_session_key,
    new_session_key,
    session_key_matches,
)


def test_roundtrip_match():
    raw = new_session_key()
    hashed = hash_session_key(raw)
    assert session_key_matches(raw, hashed)
    assert not session_key_matches("nope", hashed)
    assert not session_key_matches("", hashed)
    assert not session_key_matches(None, hashed)


def test_legacy_null_hash_allows_access():
    assert session_key_matches(None, None)
    assert session_key_matches("anything", None)
    assert session_key_matches(None, "")


def test_magicmock_hash_treated_as_legacy():
    class _Fake:
        pass

    assert session_key_matches(None, _Fake())


def test_extract_prefers_header():
    class _Req:
        headers = {"x-session-key": " header-key "}

    assert extract_session_key(_Req(), query_key="query-key") == "header-key"


def test_extract_falls_back_to_query():
    class _Req:
        headers = {}

    assert extract_session_key(_Req(), query_key=" query-key ") == "query-key"
