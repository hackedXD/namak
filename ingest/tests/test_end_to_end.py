"""The S3 vertical slice, end to end and fully offline:

    fetch → R2 (immutable) → parse (from R2 bytes) → validate → promote → query

The HTTP client is faked with the real golden PDF bytes; the parser reads the
bytes back OUT of the raw store, never from the fake — proving the §1.4 property
that parsing is a function of what's in R2, not of the fetch.
"""

from __future__ import annotations

from pathlib import Path

from ingest.core.db import Db
from ingest.core.fetch import HttpResponse, fetch_with_dedup
from ingest.core.models import RawArtifact
from ingest.core.promote import promote_ceilings
from ingest.core.rawstore import LocalRawStore
from ingest.sources.nppa_ceiling import NppaCeilingSource

FIXTURE = Path(__file__).parent / "golden" / "nppa_ceiling" / "compendium-prices-2022.pdf"


class FakeHttp:
    def __init__(self, body: bytes):
        self.body = body

    def get(self, url, headers):
        return HttpResponse(200, self.body, {"content-type": "application/pdf"})


def test_s3_slice_end_to_end(tmp_path):
    pdf_bytes = FIXTURE.read_bytes()
    db = Db(":memory:")
    db.apply_migrations()
    db.upsert_source(
        "nppa_ceiling", "NPPA ceiling prices",
        "https://nppa.gov.in/en/compendiumofprice", "public", "event", 1,
    )
    store = LocalRawStore(tmp_path)
    src = NppaCeilingSource()

    # 1. FETCH → RAW STORE
    out = fetch_with_dedup(
        source_id=src.id, url=src.url, ext="pdf",
        http=FakeHttp(pdf_bytes), store=store, db=db, today="2026-08-10",
    )
    assert out.reason == "new" and out.snapshot is not None
    snap = out.snapshot
    assert snap.r2_key.startswith("raw/nppa_ceiling/2026-08-10/")

    # 2. PARSE — from the immutable store, NOT from the response object
    raw = store.get(snap.r2_key)
    rows = [r.fields for r in src.parse(RawArtifact(src.id, raw, ext="pdf"))]
    assert len(rows) > 1000

    # 3. VALIDATE
    from ingest.core.models import StagedRow

    report = src.validate([StagedRow("staging_ceiling", r) for r in rows])
    assert report.ok, report.summary()
    db.set_snapshot_status(snap.id, "parsed", row_count=len(rows))

    # 4. PROMOTE (append-only)
    result = promote_ceilings(db, snap.id, rows)
    assert result.inserted == len(rows)
    assert result.version == 1

    # 5. QUERY — a known real ceiling comes back with its provenance
    row = db.find_current_ceiling("Halothane Inhalation 1 ml")
    assert row is not None
    assert float(row["ceiling_price"]) == 6.5
    assert row["notification_no"] == "1499(E)"
    assert row["notification_date"] == "2022-03-30"
    assert row["snapshot_id"] == snap.id  # provenance intact

    # snapshot promoted, version recorded
    promoted = db.latest_promoted_snapshot("nppa_ceiling")
    assert promoted is not None and promoted.id == snap.id


def test_refetch_same_bytes_is_deduped(tmp_path):
    pdf_bytes = FIXTURE.read_bytes()
    db = Db(":memory:")
    db.apply_migrations()
    db.upsert_source("nppa_ceiling", "NPPA", "https://nppa.gov.in", "public", "event", 1)
    store = LocalRawStore(tmp_path)
    http = FakeHttp(pdf_bytes)

    a = fetch_with_dedup(source_id="nppa_ceiling", url="u", ext="pdf", http=http, store=store, db=db, today="2026-08-10")
    b = fetch_with_dedup(source_id="nppa_ceiling", url="u", ext="pdf", http=http, store=store, db=db, today="2026-08-11")
    assert a.reason == "new"
    assert b.reason == "unchanged_by_hash"
