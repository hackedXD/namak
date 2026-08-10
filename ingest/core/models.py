"""Core data types for the ingestion plane.

These are deliberately small, immutable dataclasses. They are the contract
between the four ingestion steps (fetch → parse → validate → promote) and carry
no behaviour beyond construction.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Cadence(str, Enum):
    DAILY = "daily"
    MONTHLY = "monthly"
    EVENT = "event"
    ANNUAL = "annual"
    RARE = "rare"


class SnapshotStatus(str, Enum):
    FETCHED = "fetched"
    PARSED = "parsed"
    QUARANTINED = "quarantined"
    PROMOTED = "promoted"


@dataclass(frozen=True)
class RawArtifact:
    """Bytes as fetched from a source, plus enough metadata to store them
    content-addressed in R2. The parser is a pure function of ``content``."""

    source_id: str
    content: bytes
    content_type: str | None = None
    ext: str = "bin"
    fetched_url: str | None = None


@dataclass(frozen=True)
class Snapshot:
    """A row of ``source_snapshot`` — one immutable fetch of one source."""

    id: int
    source_id: str
    sha256: str
    r2_key: str
    fetched_at: str
    status: str
    row_count: int | None = None
    etag: str | None = None
    last_modified: str | None = None


@dataclass(frozen=True)
class StagedRow:
    """A single parsed row destined for a staging table. ``entity`` selects the
    table; ``fields`` are the column values. Parsers emit these and nothing else
    — they never touch the database or the network."""

    entity: str
    fields: dict[str, Any]


@dataclass(frozen=True)
class GateResult:
    gate: str
    passed: bool
    detail: str = ""
    fatal: bool = True  # a failed fatal gate quarantines the snapshot


@dataclass(frozen=True)
class ValidationReport:
    results: list[GateResult] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(r.passed for r in self.results if r.fatal)

    @property
    def failures(self) -> list[GateResult]:
        return [r for r in self.results if not r.passed]

    def summary(self) -> str:
        return "; ".join(
            f"{r.gate}:{'ok' if r.passed else 'FAIL'}"
            + (f"({r.detail})" if r.detail else "")
            for r in self.results
        )
