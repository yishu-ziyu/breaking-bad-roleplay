"""Validate user-supplied outbound URLs (BYOK custom / cliproxy).

Blocks SSRF to loopback, link-local, private, metadata, and non-http(s)
schemes. Preset vendor hosts are allowlisted so tests and offline deploys
do not depend on live DNS.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

# Official catalog default hosts — https only, no DNS required.
PRESET_ALLOWED_HOSTS: frozenset[str] = frozenset(
    {
        "api.minimaxi.com",
        "api.minimax.io",
        "api.stepfun.com",
        "api.deepseek.com",
        "api.openai.com",
        "generativelanguage.googleapis.com",
        "api.moonshot.cn",
        "dashscope.aliyuncs.com",
        "open.bigmodel.cn",
        "openrouter.ai",
        "api.siliconflow.cn",
    }
)

_BLOCKED_NETWORKS = (
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("100.100.100.200/32"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("fd00:ec2::254/128"),
)

_BLOCKED_HOST_SUFFIXES = (".local", ".internal", ".localhost", ".invalid")
_BLOCKED_HOSTS = frozenset(
    {
        "localhost",
        "metadata.google.internal",
        "metadata.google",
        "metadata",
    }
)


class UnsafeOutboundURL(ValueError):
    """Raised when a user-supplied base URL is not safe to fetch."""


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if getattr(ip, "ipv4_mapped", None):
        ip = ip.ipv4_mapped  # type: ignore[assignment]
    if any(ip in net for net in _BLOCKED_NETWORKS):
        return True
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast:
        return True
    if ip.is_unspecified or ip.is_reserved:
        return True
    is_global = getattr(ip, "is_global", None)
    if is_global is False:
        return True
    return False


def _host_is_blocked_name(host: str) -> bool:
    lowered = host.lower().rstrip(".")
    if lowered in _BLOCKED_HOSTS:
        return True
    return any(lowered.endswith(suf) for suf in _BLOCKED_HOST_SUFFIXES)


def _resolve_host(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeOutboundURL(f"Cannot resolve host: {host}") from exc
    addrs: list[str] = []
    for info in infos:
        sockaddr = info[4]
        if sockaddr:
            addrs.append(str(sockaddr[0]))
    if not addrs:
        raise UnsafeOutboundURL(f"Cannot resolve host: {host}")
    return addrs


def validate_outbound_base_url(
    raw: str,
    *,
    allow_loopback: bool = False,
    resolver=_resolve_host,
) -> str:
    """Return a cleaned base URL or raise ``UnsafeOutboundURL``.

    ``allow_loopback`` is only for local cliproxy in development/test.
    """
    if not raw or not isinstance(raw, str):
        raise UnsafeOutboundURL("baseUrl is required")
    cleaned = raw.strip()
    parsed = urlparse(cleaned)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeOutboundURL("baseUrl must be http or https")
    if parsed.username or parsed.password:
        raise UnsafeOutboundURL("baseUrl must not include credentials")
    host = (parsed.hostname or "").strip()
    if not host:
        raise UnsafeOutboundURL("baseUrl host is required")
    if _host_is_blocked_name(host) and not allow_loopback:
        raise UnsafeOutboundURL("baseUrl host is not allowed")

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None

    if ip is not None:
        if _is_blocked_ip(ip) and not (allow_loopback and ip.is_loopback):
            raise UnsafeOutboundURL("baseUrl points to a private or reserved address")
        if parsed.scheme != "https" and not allow_loopback:
            raise UnsafeOutboundURL("custom baseUrl must use https")
        return cleaned.rstrip("/")

    if host.lower() in PRESET_ALLOWED_HOSTS:
        if parsed.scheme != "https":
            raise UnsafeOutboundURL("preset hosts must use https")
        return cleaned.rstrip("/")

    if parsed.scheme != "https" and not allow_loopback:
        raise UnsafeOutboundURL("custom baseUrl must use https")

    for addr in resolver(host):
        try:
            resolved = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if _is_blocked_ip(resolved) and not (allow_loopback and resolved.is_loopback):
            raise UnsafeOutboundURL("baseUrl resolves to a private or reserved address")

    return cleaned.rstrip("/")
