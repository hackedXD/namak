"""Generic validation gates (§3.3.2).

Philosophy (§1.1 principle 4): fail closed. A failed fatal gate quarantines the
whole snapshot rather than partial-promoting — better to serve data that is 30
days stale and correct than 1 day stale and internally inconsistent (§3.3.2).

These gates operate on already-parsed staging rows (list of field dicts). Source-
specific gates live on the Source itself; these are the ones every source gets.
"""

from __future__ import annotations

import re
from datetime import date

from .models import GateResult, ValidationReport

_PRICE_MAX = 500_000.0
_NOTIF_RE = re.compile(r"^\d{2,5}\(E\)$")
_ROW_DRIFT_LIMIT = 0.20  # |Δrows| ≤ 20%
_NULL_RATE_LIMIT = 0.02  # nulls in required column ≤ 2%
_PRICE_DRIFT_FACTOR = 2.0  # no single price ×2 or ÷2
_PRICE_DRIFT_ROW_LIMIT = 0.01  # quarantine if >1% of rows drift

_REQUIRED = ("raw_description", "ceiling_price", "notification_no", "notification_date")


def gate_schema(rows: list[dict]) -> GateResult:
    if not rows:
        return GateResult("schema", False, "no rows parsed")
    bad = 0
    for r in rows:
        if not all(k in r and r[k] is not None for k in _REQUIRED):
            bad += 1
            continue
        if not isinstance(r["ceiling_price"], (int, float)):
            bad += 1
            continue
        if not _NOTIF_RE.match(str(r["notification_no"])):
            bad += 1
            continue
        try:
            date.fromisoformat(str(r["notification_date"]))
        except ValueError:
            bad += 1
    return GateResult(
        "schema", bad == 0, f"{bad}/{len(rows)} rows malformed" if bad else ""
    )


def gate_null_explosion(rows: list[dict]) -> GateResult:
    if not rows:
        return GateResult("null_explosion", False, "no rows")
    worst = 0.0
    detail = ""
    for col in _REQUIRED:
        nulls = sum(1 for r in rows if r.get(col) in (None, ""))
        rate = nulls / len(rows)
        if rate > worst:
            worst, detail = rate, f"{col}={rate:.1%}"
    return GateResult("null_explosion", worst <= _NULL_RATE_LIMIT, detail)


def gate_price_sanity(rows: list[dict]) -> GateResult:
    bad = [
        r["raw_description"]
        for r in rows
        if not (0 < float(r["ceiling_price"]) < _PRICE_MAX)
    ]
    return GateResult(
        "price_sanity",
        not bad,
        f"{len(bad)} out-of-range prices" if bad else "",
    )


def gate_encoding(rows: list[dict]) -> GateResult:
    # No replacement chars / mojibake in the verbatim text we captured.
    bad = sum(1 for r in rows if "�" in str(r.get("raw_line", "")))
    return GateResult("encoding", bad == 0, f"{bad} rows with U+FFFD" if bad else "")


def gate_row_count_drift(n_rows: int, prev_row_count: int | None) -> GateResult:
    if not prev_row_count:
        return GateResult("row_count_drift", True, "no prior snapshot", fatal=False)
    delta = abs(n_rows - prev_row_count) / prev_row_count
    return GateResult(
        "row_count_drift",
        delta <= _ROW_DRIFT_LIMIT,
        f"Δ={delta:.1%} ({prev_row_count}→{n_rows})",
    )


def gate_price_drift(
    rows: list[dict],
    prev_rows: list[dict] | None,
    key: str = "raw_description",
) -> GateResult:
    """CANONICAL-LAYER gate. Not run in the staging pipeline: it needs a stable
    per-formulation identity, which staging rows do not have until the normaliser
    (§4.1) resolves them (continuation rows share text). Wired in once ceilings
    carry a formulation_id; unit-tested here against rows with unique keys."""
    if not prev_rows:
        return GateResult("price_drift", True, "no prior snapshot", fatal=False)
    prev = {r[key]: float(r["ceiling_price"]) for r in prev_rows}
    drifted = 0
    compared = 0
    for r in rows:
        old = prev.get(r[key])
        if old is None or old == 0:
            continue
        compared += 1
        ratio = float(r["ceiling_price"]) / old
        if ratio >= _PRICE_DRIFT_FACTOR or ratio <= 1 / _PRICE_DRIFT_FACTOR:
            drifted += 1
    if compared == 0:
        return GateResult("price_drift", True, "no overlap", fatal=False)
    rate = drifted / compared
    return GateResult(
        "price_drift",
        rate <= _PRICE_DRIFT_ROW_LIMIT,
        f"{drifted}/{compared} drifted ({rate:.1%})",
    )


def run_generic_gates(
    rows: list[dict],
    prev_row_count: int | None = None,
) -> ValidationReport:
    """Gates valid at the staging layer (no per-formulation identity required).
    price_drift is deliberately excluded — see gate_price_drift's docstring."""
    return ValidationReport(
        results=[
            gate_schema(rows),
            gate_null_explosion(rows),
            gate_price_sanity(rows),
            gate_encoding(rows),
            gate_row_count_drift(len(rows), prev_row_count),
        ]
    )
