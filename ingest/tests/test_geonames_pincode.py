"""S10 (GeoNames pincode) — golden parser test + end-to-end slice.

Fixture is REAL bytes from download.geonames.org. Network is disabled (conftest)
to prove parse() purity.
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path

from ingest.core.db import Db
from ingest.core.fetch import HttpResponse, fetch_with_dedup
from ingest.core.models import RawArtifact, StagedRow
from ingest.core.promote import promote_pincentroids
from ingest.core.rawstore import LocalRawStore
from ingest.sources.geonames_pincode import GeonamesPincodeSource

GOLDEN = Path(__file__).parent / "golden" / "geonames_pincode"
FIXTURE = GOLDEN / "IN.zip"
EXPECTED = json.loads((GOLDEN / "expected.json").read_text())


@lru_cache(maxsize=1)
def _rows() -> tuple:
    data = FIXTURE.read_bytes()
    return tuple(
        r.fields for r in GeonamesPincodeSource().parse(RawArtifact("geonames_pincode", data, ext="zip"))
    )


def test_fixture_integrity():
    assert hashlib.sha256(FIXTURE.read_bytes()).hexdigest() == EXPECTED["fixture_sha256"]


def test_parse_is_deterministic():
    data = FIXTURE.read_bytes()
    src = GeonamesPincodeSource()
    a = [r.fields for r in src.parse(RawArtifact("geonames_pincode", data, ext="zip"))]
    b = [r.fields for r in src.parse(RawArtifact("geonames_pincode", data, ext="zip"))]
    assert a == b


def test_one_row_per_pincode_count():
    rows = _rows()
    assert len(rows) == EXPECTED["total_pincodes"]
    pins = [r["pincode"] for r in rows]
    assert len(set(pins)) == len(pins)  # no duplicate pincodes


def test_verified_centroids():
    by_pin = {r["pincode"]: r for r in _rows()}
    for want in EXPECTED["rows"]:
        got = by_pin.get(want["pincode"])
        assert got is not None, f"missing pincode {want['pincode']}"
        assert got["lat"] == want["lat"]
        assert got["lng"] == want["lng"]
        assert got["place_count"] == want["place_count"]
        assert got["state"] == want["state"]
        assert got["district"] == want["district"]


def test_all_pincodes_6_digit_and_in_india_box():
    for r in _rows():
        assert str(r["pincode"]).isdigit() and len(r["pincode"]) == 6
        assert 6.0 <= r["lat"] <= 37.5
        assert 68.0 <= r["lng"] <= 97.5


def test_validation_passes_on_real_data():
    src = GeonamesPincodeSource()
    report = src.validate([StagedRow("pin_centroid", r) for r in _rows()])
    assert report.ok, report.summary()


class _FakeHttp:
    def __init__(self, body: bytes):
        self.body = body

    def get(self, url, headers):
        return HttpResponse(200, self.body, {"content-type": "application/zip"})


def test_s10_slice_end_to_end(tmp_path):
    db = Db(":memory:")
    db.apply_migrations()
    src = GeonamesPincodeSource()
    db.upsert_source(src.id, "GeoNames India postal (CC-BY)", src.url, "cc-by-4.0", src.cadence.value, 2)
    store = LocalRawStore(tmp_path)

    out = fetch_with_dedup(
        source_id=src.id, url=src.url, ext="zip",
        http=_FakeHttp(FIXTURE.read_bytes()), store=store, db=db, today="2026-08-10",
    )
    assert out.reason == "new" and out.snapshot is not None
    snap = out.snapshot

    rows = [r.fields for r in src.parse(RawArtifact(src.id, store.get(snap.r2_key), ext="zip"))]
    report = src.validate([StagedRow("pin_centroid", r) for r in rows])
    assert report.ok, report.summary()

    res = promote_pincentroids(db, snap.id, src.id, rows)
    assert res.inserted == EXPECTED["total_pincodes"]
    assert res.superseded == 0 and res.unchanged == 0

    # query end — a known pincode centroid with provenance
    row = db.find_current_pincentroid("110001")
    assert row is not None
    assert row["lat"] == 28.64269 and row["lng"] == 77.219429
    assert row["snapshot_id"] == snap.id
    assert row["source_id"] == "geonames_pincode"
    assert len(db.current_pincentroids()) == EXPECTED["total_pincodes"]


def test_reingest_unchanged_is_noop():
    db = Db(":memory:")
    db.apply_migrations()
    src = GeonamesPincodeSource()
    db.upsert_source(src.id, "GeoNames", src.url, "cc-by-4.0", src.cadence.value, 2)
    rows = list(_rows())

    s1 = db.insert_snapshot(src.id, "sha1", "k1")
    promote_pincentroids(db, s1.id, src.id, rows)
    s2 = db.insert_snapshot(src.id, "sha2", "k2")
    res = promote_pincentroids(db, s2.id, src.id, rows)
    assert res.inserted == 0
    assert res.unchanged == len(rows)
    assert len(db.current_pincentroids()) == len(rows)


def test_moved_centroid_supersedes_per_pincode():
    db = Db(":memory:")
    db.apply_migrations()
    src = GeonamesPincodeSource()
    db.upsert_source(src.id, "GeoNames", src.url, "cc-by-4.0", src.cadence.value, 2)
    rows = [dict(r) for r in list(_rows())[:200]]

    s1 = db.insert_snapshot(src.id, "sha1", "k1")
    promote_pincentroids(db, s1.id, src.id, rows)

    moved = [dict(r) for r in rows]
    moved[0]["lat"] = round(moved[0]["lat"] + 0.01, 6)
    s2 = db.insert_snapshot(src.id, "sha2", "k2")
    res = promote_pincentroids(db, s2.id, src.id, moved)
    assert res.superseded == 1
    assert res.inserted == 1
    assert res.unchanged == len(rows) - 1

    # exactly one current row for that pincode, at the new position; old retained
    pin = rows[0]["pincode"]
    hist = db.conn.execute(
        "SELECT lat, valid_to FROM pin_centroid WHERE pincode=? ORDER BY id", (pin,)
    ).fetchall()
    assert len(hist) == 2
    assert hist[0]["valid_to"] is not None
    assert hist[1]["valid_to"] is None
