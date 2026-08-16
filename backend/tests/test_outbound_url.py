"""SSRF guards for user-supplied BYOK base URLs."""

from __future__ import annotations

import os

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")

import pytest

from agents.outbound_url import UnsafeOutboundURL, validate_outbound_base_url


def test_rejects_loopback():
    with pytest.raises(UnsafeOutboundURL):
        validate_outbound_base_url("http://127.0.0.1:8080/v1")
    with pytest.raises(UnsafeOutboundURL):
        validate_outbound_base_url("http://localhost/v1")


def test_rejects_link_local_metadata():
    with pytest.raises(UnsafeOutboundURL):
        validate_outbound_base_url("http://169.254.169.254/latest/meta-data/")
    with pytest.raises(UnsafeOutboundURL):
        validate_outbound_base_url("http://100.100.100.200/latest/meta-data/")


def test_rejects_private_rfc1918():
    for url in (
        "http://10.0.0.5/v1",
        "http://192.168.1.1/v1",
        "http://172.16.0.8/v1",
    ):
        with pytest.raises(UnsafeOutboundURL):
            validate_outbound_base_url(url)


def test_rejects_credentials_and_non_http():
    with pytest.raises(UnsafeOutboundURL):
        validate_outbound_base_url("https://user:pass@api.openai.com/v1")
    with pytest.raises(UnsafeOutboundURL):
        validate_outbound_base_url("file:///etc/passwd")
    with pytest.raises(UnsafeOutboundURL):
        validate_outbound_base_url("gopher://example.com/1")


def test_allows_preset_https_hosts_without_dns():
    cleaned = validate_outbound_base_url("https://api.openai.com/v1/")
    assert cleaned == "https://api.openai.com/v1"


def test_rejects_http_for_public_custom_host():
    with pytest.raises(UnsafeOutboundURL):
        validate_outbound_base_url("http://api.openai.com/v1")


def test_rejects_hostname_that_resolves_private():
    def fake_resolver(_host: str) -> list[str]:
        return ["10.1.2.3"]

    with pytest.raises(UnsafeOutboundURL):
        validate_outbound_base_url(
            "https://evil.example/v1",
            resolver=fake_resolver,
        )


def test_allows_hostname_that_resolves_public():
    def fake_resolver(_host: str) -> list[str]:
        return ["8.8.8.8"]

    cleaned = validate_outbound_base_url(
        "https://my-proxy.example/v1",
        resolver=fake_resolver,
    )
    assert cleaned == "https://my-proxy.example/v1"


def test_loopback_allowed_only_when_flag_set():
    cleaned = validate_outbound_base_url(
        "http://127.0.0.1:8317",
        allow_loopback=True,
    )
    assert cleaned == "http://127.0.0.1:8317"
    with pytest.raises(UnsafeOutboundURL):
        validate_outbound_base_url("http://127.0.0.1:8317", allow_loopback=False)
