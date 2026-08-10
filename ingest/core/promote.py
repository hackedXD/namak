"""Promoter — writes validated staging rows with append-only discipline (§3.3.3).

Non-negotiable #2: a price/ceiling change is a NEW row; the superseded generation
gets a valid_to. Never UPDATE a value in place; history is retained.

Two mechanisms enforce "no duplicate rows on unchanged data":
  - Content-hash dedup at fetch (§3.3.1) — identical bytes never produce a new
    snapshot, so an unchanged source never reaches promotion at all. This is the
    primary no-op path.
  - Snapshot-scoped supersession here — a newly-promoted snapshot closes the
    previous generation and inserts its own rows.

Supersession is snapshot-scoped rather than per-row because parsed S3 rows have
no stable per-formulation identity yet (continuation rows recur verbatim in the
source). Fine-grained per-formulation close-out, and the price-drift gate, move
to the CANONICAL layer once the normaliser (§4.1) assigns formulation_ids and
rows land in `ceiling_price`. That step is Milestone 4-5 and not implemented here.
"""

from __future__ import annotations

from dataclasses import dataclass

from .db import Db, utcnow_iso


@dataclass(frozen=True)
class PromotionResult:
    version: int
    inserted: int
    superseded: int


@dataclass(frozen=True)
class PinCentroidPromotionResult:
    version: int
    inserted: int
    superseded: int
    unchanged: int


def promote_ceilings(db: Db, snapshot_id: int, rows: list[dict]) -> PromotionResult:
    now = utcnow_iso()

    with db.conn:  # single transaction; advisory single-writer (§5.6)
        superseded = db.close_current_ceilings_for_source(snapshot_id, now)
        inserted = 0
        for r in rows:
            db.conn.execute(
                """INSERT INTO staging_ceiling(
                     snapshot_id, source_page, nlem_section, raw_description,
                     ceiling_price, notification_no, notification_date, raw_line,
                     valid_from, valid_to, ingested_at)
                   VALUES(?,?,?,?,?,?,?,?,?,NULL,?)""",
                (
                    snapshot_id,
                    r.get("source_page"),
                    r.get("nlem_section"),
                    r["raw_description"],
                    r["ceiling_price"],
                    r["notification_no"],
                    r["notification_date"],
                    r["raw_line"],
                    r["notification_date"],  # valid_from = effective date
                    now,
                ),
            )
            inserted += 1

    version = db.next_knowledge_version([snapshot_id])
    db.set_snapshot_status(snapshot_id, "promoted", row_count=inserted)
    return PromotionResult(version=version, inserted=inserted, superseded=superseded)


def promote_pincentroids(
    db: Db, snapshot_id: int, source_id: str, rows: list[dict]
) -> PinCentroidPromotionResult:
    """Append-only, PER-PINCODE supersession. Because a pincode is a stable
    identity (unlike a parsed ceiling description), we can do proper row-level
    close-out: an unchanged centroid is a no-op, a moved one closes the old row
    (valid_to) and inserts a new one. History is retained; nothing is UPDATEd
    in place."""
    inserted = superseded = unchanged = 0
    now = utcnow_iso()

    with db.conn:
        for r in rows:
            existing = db.find_current_pincentroid(r["pincode"])
            if (
                existing is not None
                and round(float(existing["lat"]), 6) == r["lat"]
                and round(float(existing["lng"]), 6) == r["lng"]
            ):
                unchanged += 1
                continue
            if existing is not None:
                db.conn.execute(
                    "UPDATE pin_centroid SET valid_to=? WHERE id=? AND valid_to IS NULL",
                    (now, existing["id"]),
                )
                superseded += 1
            db.conn.execute(
                """INSERT INTO pin_centroid(
                     pincode, lat, lng, place_count, state, district,
                     source_id, snapshot_id, valid_from, valid_to, ingested_at)
                   VALUES(?,?,?,?,?,?,?,?,?,NULL,?)""",
                (
                    r["pincode"],
                    r["lat"],
                    r["lng"],
                    r["place_count"],
                    r.get("state"),
                    r.get("district"),
                    source_id,
                    snapshot_id,
                    now,
                    now,
                ),
            )
            inserted += 1

    version = db.next_knowledge_version([snapshot_id])
    db.set_snapshot_status(snapshot_id, "promoted", row_count=inserted)
    return PinCentroidPromotionResult(
        version=version, inserted=inserted, superseded=superseded, unchanged=unchanged
    )
