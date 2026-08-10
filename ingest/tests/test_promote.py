"""Promoter: append-only, snapshot-scoped supersession (non-negotiable #2).
Uses real parsed rows — no invented data."""

from __future__ import annotations

import copy
from functools import lru_cache
from pathlib import Path

from ingest.core.db import Db
from ingest.core.models import RawArtifact
from ingest.core.promote import promote_ceilings
from ingest.sources.nppa_ceiling import NppaCeilingSource

GOLDEN = Path(__file__).parent / "golden" / "nppa_ceiling"


@lru_cache(maxsize=1)
def _all_rows() -> tuple:
    data = (GOLDEN / "compendium-prices-2022.pdf").read_bytes()
    return tuple(
        r.fields for r in NppaCeilingSource().parse(RawArtifact("nppa_ceiling", data, ext="pdf"))
    )


def _real_rows(n=40):
    # fresh list of the shared dicts; callers deepcopy before any mutation
    return list(_all_rows()[:n])


def _fresh_db():
    db = Db(":memory:")
    db.apply_migrations()
    db.upsert_source("nppa_ceiling", "NPPA", "https://nppa.gov.in", "public", "event", 1)
    return db


def _snap(db, sha, key):
    return db.insert_snapshot("nppa_ceiling", sha, key)


def test_first_promote_inserts_all():
    db = _fresh_db()
    snap = _snap(db, "sha1", "raw/nppa_ceiling/2026-08-10/sha1.pdf")
    rows = _real_rows()
    res = promote_ceilings(db, snap.id, rows)
    assert res.inserted == len(rows)
    assert res.superseded == 0
    assert len(db.current_staging_ceilings()) == len(rows)


def test_new_snapshot_supersedes_previous_generation():
    db = _fresh_db()
    rows = _real_rows()
    snap1 = _snap(db, "sha1", "k1")
    promote_ceilings(db, snap1.id, rows)

    snap2 = _snap(db, "sha2", "k2")
    res = promote_ceilings(db, snap2.id, rows)

    assert res.superseded == len(rows)  # old generation closed
    assert res.inserted == len(rows)
    # current set is exactly the new generation…
    assert len(db.current_staging_ceilings()) == len(rows)
    # …but history is retained: both generations still in the table
    total = db.conn.execute("SELECT COUNT(*) AS c FROM staging_ceiling").fetchone()["c"]
    assert total == 2 * len(rows)


def test_price_change_is_a_new_row_not_an_update():
    db = _fresh_db()
    rows = _real_rows()
    snap1 = _snap(db, "sha1", "k1")
    promote_ceilings(db, snap1.id, rows)

    # 'Halothane Inhalation 1 ml' is a unique description in the source; bump it.
    desc = "Halothane Inhalation 1 ml"
    old_price = db.find_current_ceiling(desc)["ceiling_price"]
    changed = copy.deepcopy(rows)
    for r in changed:
        if r["raw_description"] == desc:
            r["ceiling_price"] = old_price + 1.0
            r["notification_date"] = "2026-04-01"

    snap2 = _snap(db, "sha2", "k2")
    promote_ceilings(db, snap2.id, changed)

    # current row reflects the new price…
    current = db.find_current_ceiling(desc)
    assert float(current["ceiling_price"]) == old_price + 1.0
    assert current["snapshot_id"] == snap2.id
    # …and the old value is preserved as a closed row (valid_to set)
    history = db.conn.execute(
        "SELECT ceiling_price, valid_to, snapshot_id FROM staging_ceiling "
        "WHERE raw_description=? ORDER BY id",
        (desc,),
    ).fetchall()
    assert len(history) == 2
    assert history[0]["snapshot_id"] == snap1.id and history[0]["valid_to"] is not None
    assert float(history[0]["ceiling_price"]) == old_price
    assert history[1]["valid_to"] is None


def test_knowledge_version_increments_on_promote():
    db = _fresh_db()
    snap1 = _snap(db, "sha1", "k1")
    assert promote_ceilings(db, snap1.id, _real_rows()).version == 1
    snap2 = _snap(db, "sha2", "k2")
    assert promote_ceilings(db, snap2.id, _real_rows(10)).version == 2
