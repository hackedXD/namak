"""Test config. Enforces the core non-negotiable: parsers are pure functions of
bytes and NEVER touch the network (§3.3). We disable real socket connections for
the entire suite; anything that needs HTTP in tests must use an injected fake.
"""

from __future__ import annotations

import socket

import pytest

_ALLOWED = {"127.0.0.1", "::1", "localhost"}


class NetworkDisabledError(RuntimeError):
    pass


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    real_connect = socket.socket.connect

    def guarded_connect(self, address, *args, **kwargs):
        host = address[0] if isinstance(address, tuple) else address
        if host not in _ALLOWED:
            raise NetworkDisabledError(
                f"network disabled in tests (attempted connect to {host!r})"
            )
        return real_connect(self, address, *args, **kwargs)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    yield
