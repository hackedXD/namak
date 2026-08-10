"""fetch_with_dedup: conditional GET + content-hash dedup (§3.3.1).

Uses a fake HTTP client — no real network (also enforced by conftest)."""

from __future__ import annotations

from ingest.core.db import Db
from ingest.core.fetch import HttpResponse, fetch_with_dedup
from ingest.core.rawstore import LocalRawStore


class FakeHttp:
    def __init__(self, response: HttpResponse):
        self.response = response
        self.calls: list[tuple[str, dict]] = []

    def get(self, url, headers):
        self.calls.append((url, dict(headers)))
        return self.response


def _db():
    db = Db(":memory:")
    db.apply_migrations()
    db.upsert_source(
        "nppa_ceiling", "NPPA", "https://nppa.gov.in", "public", "event", 1
    )
    return db


def test_new_content_writes_snapshot_and_raw(tmp_path):
    db = _db()
    store = LocalRawStore(tmp_path)
    http = FakeHttp(HttpResponse(200, b"%PDF-1.7 real bytes", {"content-type": "application/pdf"}))

    out = fetch_with_dedup(
        source_id="nppa_ceiling", url="https://nppa.gov.in/x.pdf", ext="pdf",
        http=http, store=store, db=db, today="2026-08-10",
    )
    assert out.reason == "new"
    assert out.snapshot is not None
    assert store.exists(out.snapshot.r2_key)
    assert store.get(out.snapshot.r2_key) == b"%PDF-1.7 real bytes"


def test_identical_content_dedups_by_hash(tmp_path):
    db = _db()
    store = LocalRawStore(tmp_path)
    http = FakeHttp(HttpResponse(200, b"identical", {}))

    first = fetch_with_dedup(
        source_id="nppa_ceiling", url="u", ext="pdf",
        http=http, store=store, db=db, today="2026-08-10",
    )
    assert first.reason == "new"
    second = fetch_with_dedup(
        source_id="nppa_ceiling", url="u", ext="pdf",
        http=http, store=store, db=db, today="2026-08-11",
    )
    assert second.reason == "unchanged_by_hash"
    assert second.snapshot is None


def test_304_not_modified_exits_early(tmp_path):
    db = _db()
    store = LocalRawStore(tmp_path)
    http = FakeHttp(HttpResponse(304, b"", {}))
    out = fetch_with_dedup(
        source_id="nppa_ceiling", url="u", ext="pdf",
        http=http, store=store, db=db, today="2026-08-10",
    )
    assert out.reason == "unchanged_304"
    assert out.snapshot is None
