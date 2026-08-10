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
