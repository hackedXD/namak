"""The raw store — Salt's most important reliability decision (§1.1 principle 2).

Every fetch is written here byte-identical BEFORE parsing, content-addressed by
sha256, and never mutated. Parsers read from here, never from the network, which
is what makes every parse deterministic and replayable.

``RawStore`` is the interface. ``LocalRawStore`` is a filesystem implementation
for local dev and tests; the production implementation writes to Cloudflare R2
with the same key layout. Nothing downstream cares which one it is (§5.4).
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from .hashing import sha256_bytes


def raw_key(source_id: str, iso_date: str, sha256: str, ext: str) -> str:
    """Content-addressed key, exactly as in design §1.4:
    ``raw/{source_id}/{iso_date}/{sha256}.{ext}``."""
    return f"raw/{source_id}/{iso_date}/{sha256}.{ext}"


class RawStore(Protocol):
    def put(self, key: str, data: bytes) -> None:
        """Write bytes. Immutable: writing the same key with the SAME bytes is a
        no-op; writing DIFFERENT bytes to an existing key must raise."""

    def get(self, key: str) -> bytes:
        ...

    def exists(self, key: str) -> bool:
        ...


class ImmutabilityError(RuntimeError):
    pass


class LocalRawStore:
    """Filesystem-backed raw store. Enforces immutability by refusing to
    overwrite an existing key with different bytes."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        return self.root / key

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        if path.exists():
            existing = path.read_bytes()
            if sha256_bytes(existing) != sha256_bytes(data):
                raise ImmutabilityError(
                    f"refusing to overwrite {key} with different bytes"
                )
            return  # identical bytes → idempotent no-op
        path.parent.mkdir(parents=True, exist_ok=True)
        # write-then-rename so a crash can't leave a half-written object
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()
