"""The Source protocol. Every source implements this — no exceptions (§3.3).

The three methods are strictly separated by capability:
  fetch()    — network I/O ONLY. No parsing.
  parse()    — pure function of bytes → rows. NO network, NO db.
  validate() — source-specific sanity gates beyond the generic ones.

The parse() purity constraint is enforced in tests by disabling the network.
"""

from __future__ import annotations

from typing import Iterator, Protocol, runtime_checkable

from .models import Cadence, RawArtifact, StagedRow, ValidationReport


@runtime_checkable
class Source(Protocol):
    id: str
    cadence: Cadence
    url: str

    def parse(self, artifact: RawArtifact) -> Iterator[StagedRow]:
        """Pure: same bytes ⇒ same rows. No network, no database."""

    def validate(
        self, rows: list[StagedRow], prev: object | None
    ) -> ValidationReport:
        """Source-specific gates. Generic gates run separately (validate.py)."""
