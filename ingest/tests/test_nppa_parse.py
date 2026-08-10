"""Golden-file test for the S3 (NPPA ceiling) parser.

Fixture is REAL bytes from nppa.gov.in. Runs with the network disabled (see
conftest) to prove parse() is pure. Byte-exact on the verified rows; total-row
count is a regression guard.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from ingest.core.models import RawArtifact
from ingest.sources.nppa_ceiling import NppaCeilingSource

GOLDEN = Path(__file__).parent / "golden" / "nppa_ceiling"
FIXTURE = GOLDEN / "compendium-prices-2022.pdf"
EXPECTED = json.loads((GOLDEN / "expected.json").read_text())


def _parse():
    data = FIXTURE.read_bytes()
    src = NppaCeilingSource()
    return data, [r.fields for r in src.parse(RawArtifact("nppa_ceiling", data, ext="pdf"))]


def test_fixture_integrity():
    """The golden fixture must be the exact bytes we vetted."""
    digest = hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
    assert digest == EXPECTED["fixture_sha256"]


def test_parse_is_deterministic():
    _, rows_a = _parse()
    _, rows_b = _parse()
    assert rows_a == rows_b


def test_total_row_count_regression_guard():
    _, rows = _parse()
    assert len(rows) == EXPECTED["total_rows"]


def test_verified_rows_present_exactly():
    _, rows = _parse()
    by_line = {r["raw_line"]: r for r in rows}
    for want in EXPECTED["rows"]:
        got = by_line.get(want["raw_line"])
        assert got is not None, f"missing verified row: {want['raw_line']}"
        assert got == want


def test_nothing_is_invented():
    """Every parsed row must trace verbatim to its source line: the notification
    number and the description must appear in raw_line, and the price must be a
    positive number that was read from that line (not synthesised)."""
    _, rows = _parse()
    for r in rows:
        assert r["notification_no"] in r["raw_line"]
        assert r["raw_description"] in r["raw_line"]
        assert isinstance(r["ceiling_price"], float) and r["ceiling_price"] > 0


def test_generic_validation_passes_on_real_data():
    _, rows = _parse()
    src = NppaCeilingSource()
    from ingest.core.models import StagedRow

    report = src.validate([StagedRow("staging_ceiling", r) for r in rows])
    assert report.ok, report.summary()
