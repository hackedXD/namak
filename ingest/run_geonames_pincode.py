"""Run the S10 (GeoNames pincode centroid) source end to end against the live
source. fetch → R2 → parse → validate → promote → query.

Usage: python -m ingest.run_geonames_pincode [--db PATH] [--raw DIR]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .core.db import Db
from .core.fetch import fetch_with_dedup
from .core.http import HttpxClient
from .core.models import RawArtifact, SnapshotStatus, StagedRow
from .core.promote import promote_pincentroids
from .core.rawstore import LocalRawStore
from .sources.geonames_pincode import GeonamesPincodeSource


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="ingest/.local/salt.db")
    ap.add_argument("--raw", default="ingest/.local/raw")
    args = ap.parse_args(argv)

    Path(args.db).parent.mkdir(parents=True, exist_ok=True)
    Path(args.raw).mkdir(parents=True, exist_ok=True)

    src = GeonamesPincodeSource()
    db = Db(args.db)
    db.apply_migrations()
    db.upsert_source(
        id=src.id,
        name="GeoNames India postal centroids (CC-BY 4.0)",
        url=src.url,
        license="cc-by-4.0",  # tier-2 community source; flagged on /sources
        cadence=src.cadence.value,
        tier=2,
    )
    store = LocalRawStore(args.raw)
    http = HttpxClient()

    print(f"[fetch] {src.url}")
    try:
        out = fetch_with_dedup(
            source_id=src.id, url=src.url, ext="zip", http=http, store=store, db=db
        )
    except RuntimeError as e:
        print(f"[fetch] source unavailable: {e}\n[fetch] keeping last snapshot (fail-stale).")
        return 0
    finally:
        http.close()

    if out.snapshot is None:
        print(f"[fetch] {out.reason} — nothing to do.")
        return 0
    snap = out.snapshot
    print(f"[fetch] new snapshot #{snap.id}  sha256={snap.sha256[:12]}…  → {snap.r2_key}")

    rows = [r.fields for r in src.parse(RawArtifact(src.id, store.get(snap.r2_key), ext="zip"))]
    print(f"[parse] {len(rows)} pincode centroids")

    report = src.validate([StagedRow("pin_centroid", r) for r in rows])
    print(f"[validate] {'OK' if report.ok else 'FAIL'} — {report.summary()}")
    if not report.ok:
        db.set_snapshot_status(snap.id, SnapshotStatus.QUARANTINED.value)
        print("[validate] snapshot quarantined; NOT promoting.")
        return 1
    db.set_snapshot_status(snap.id, SnapshotStatus.PARSED.value, row_count=len(rows))

    res = promote_pincentroids(db, snap.id, src.id, rows)
    print(
        f"[promote] version={res.version} inserted={res.inserted} "
        f"superseded={res.superseded} unchanged={res.unchanged}"
    )

    ex = db.find_current_pincentroid("110001")
    if ex:
        print(f"[query] 110001 → ({ex['lat']}, {ex['lng']}) {ex['district']}, {ex['state']}")
    print(f"[done] {len(db.current_pincentroids())} current pincode centroids in D1.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
