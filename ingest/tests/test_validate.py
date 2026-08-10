"""Generic validation gates (§3.3.2). Failure cases are transformations of REAL
parsed rows, so no drug data is invented."""

from __future__ import annotations

import copy
from collections import Counter
from functools import lru_cache
from pathlib import Path

from ingest.core.models import RawArtifact
from ingest.core.validate import gate_price_drift, run_generic_gates
from ingest.sources.nppa_ceiling import NppaCeilingSource

GOLDEN = Path(__file__).parent / "golden" / "nppa_ceiling"


@lru_cache(maxsize=1)
def _all_rows() -> tuple:
    data = (GOLDEN / "compendium-prices-2022.pdf").read_bytes()
    return tuple(
        r.fields for r in NppaCeilingSource().parse(RawArtifact("nppa_ceiling", data, ext="pdf"))
    )


def _real_rows():
    return list(_all_rows())


def _unique_desc_rows(n=30):
    rows = _real_rows()
    counts = Counter(r["raw_description"] for r in rows)
    uniq = [r for r in rows if counts[r["raw_description"]] == 1]
    return uniq[:n]


def test_clean_real_data_passes_all_gates():
    report = run_generic_gates(_real_rows())
    assert report.ok, report.summary()


def test_negative_price_fails_price_sanity():
    rows = copy.deepcopy(_real_rows())
    rows[0]["ceiling_price"] = -5.0
    report = run_generic_gates(rows)
    assert not report.ok
    assert any(r.gate == "price_sanity" and not r.passed for r in report.results)


def test_absurd_price_fails_price_sanity():
    rows = copy.deepcopy(_real_rows())
    rows[0]["ceiling_price"] = 9_999_999.0
    assert not run_generic_gates(rows).ok


def test_malformed_notification_fails_schema():
    rows = copy.deepcopy(_real_rows())
    rows[0]["notification_no"] = "not-a-notification"
    report = run_generic_gates(rows)
    assert any(r.gate == "schema" and not r.passed for r in report.results)


def test_row_count_drift_flags_large_change():
    rows = _real_rows()
    # previous snapshot had ~half as many rows → >20% drift
    report = run_generic_gates(rows, prev_row_count=len(rows) // 2)
    assert any(r.gate == "row_count_drift" and not r.passed for r in report.results)


def test_price_drift_gate_flags_doubling():
    # gate_price_drift is a canonical-layer gate; test it directly on rows with
    # unique descriptions (a stable key), which is what it will have post-resolution.
    rows = _unique_desc_rows()
    prev = copy.deepcopy(rows)
    for r in prev:
        r["ceiling_price"] = r["ceiling_price"] / 2.0  # every current price ~2x
    result = gate_price_drift(rows, prev)
    assert not result.passed, result.detail


def test_price_drift_gate_clean_when_stable():
    rows = _unique_desc_rows()
    result = gate_price_drift(rows, copy.deepcopy(rows))
    assert result.passed, result.detail
