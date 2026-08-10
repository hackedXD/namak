"""Content hashing — the basis of both dedup and the immutable raw store."""

from __future__ import annotations

import hashlib


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
