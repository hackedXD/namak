"""Run the S3 (NPPA ceiling) source end to end against the live site.

    fetch → R2 (immutable) → parse (from R2) → validate → promote → query

This is the real-network entrypoint (the test suite exercises the same pipeline
offline). Data lands in a local SQLite file and a local raw store, mirroring what
D1 + R2 do in production.

Usage:
    python -m ingest.run_nppa_ceiling [--db PATH] [--raw DIR]

The artifact URL below is NPPA's Compendium of Ceiling Prices PDF. NOTE: the
website serves it under a content-hashed path that will change when NPPA
republishes; resolving the current link from the compendium page is a follow-up
(kept out of this first slice).
"""

from __future__ import annotations

import argparse
import sys

from .core.db import Db
from .core.fetch import fetch_with_dedup
from .core.http import HttpxClient
from .core.models import RawArtifact, SnapshotStatus, StagedRow
from .core.promote import promote_ceilings
from .core.rawstore import LocalRawStore
from .sources.nppa_ceiling import NppaCeilingSource

# Direct artifact URL (see module docstring re: link resolution as a follow-up).
ARTIFACT_URL = (
    "https://nppa.gov.in/storage/uploads/pdf/"
    "Compendium-Prices-2022pdf-464b22085495ff4e3f8700c0e00cf45d.pdf"
)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="ingest/.local/salt.db")
    ap.add_argument("--raw", default="ingest/.local/raw")
    args = ap.parse_args(argv)

    from pathlib import Path

    Path(args.db).parent.mkdir(parents=True, exist_ok=True)
    Path(args.raw).mkdir(parents=True, exist_ok=True)

    src = NppaCeilingSource()
    db = Db(args.db)
    db.apply_migrations()
    db.upsert_source(
        id=src.id,
        name="NPPA ceiling prices (Compendium)",
        url=src.url,
        license="public",
        cadence=src.cadence.value,
        tier=1,
    )
    store = LocalRawStore(args.raw)
    http = HttpxClient()

    print(f"[fetch] {ARTIFACT_URL}")
    try:
        outcome = fetch_with_dedup(
            source_id=src.id, url=ARTIFACT_URL, ext="pdf", http=http, store=store, db=db
        )
    except RuntimeError as e:
        # e.g. a 503 when a gov host throttles the egress IP. Fail stale (§1.1):
        # keep the last promoted snapshot; do not crash the pipeline.
        print(f"[fetch] source unavailable: {e}")
        print("[fetch] keeping last promoted snapshot (fail-stale).")
        return 0
    finally:
        http.close()

    if outcome.snapshot is None:
        print(f"[fetch] {outcome.reason} — nothing to do.")
        return 0
    snap = outcome.snapshot
    print(f"[fetch] new snapshot #{snap.id}  sha256={snap.sha256[:12]}…  → {snap.r2_key}")

    # parse from the immutable store, never from the response
    raw = store.get(snap.r2_key)
    rows = [r.fields for r in src.parse(RawArtifact(src.id, raw, ext="pdf"))]
    print(f"[parse] {len(rows)} ceiling rows")

    report = src.validate([StagedRow("staging_ceiling", r) for r in rows])
    print(f"[validate] {'OK' if report.ok else 'FAIL'} — {report.summary()}")
    if not report.ok:
        db.set_snapshot_status(snap.id, SnapshotStatus.QUARANTINED.value)
        print("[validate] snapshot quarantined; NOT promoting.")
        return 1
    db.set_snapshot_status(snap.id, SnapshotStatus.PARSED.value, row_count=len(rows))

    result = promote_ceilings(db, snap.id, rows)
    print(
        f"[promote] version={result.version} inserted={result.inserted} "
        f"superseded={result.superseded}"
    )

    # prove the query end
    example = db.find_current_ceiling("Halothane Inhalation 1 ml")
    if example:
        print(
            f"[query] Halothane Inhalation 1 ml → ₹{example['ceiling_price']} "
            f"(S.O.{example['notification_no']} {example['notification_date']}, "
            f"snapshot #{example['snapshot_id']})"
        )
    print(f"[done] {len(db.current_staging_ceilings())} current ceilings in D1.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
