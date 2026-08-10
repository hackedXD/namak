"""SQLite-backed knowledge store for the ingestion plane.

Local dev/CI uses a SQLite file; production writes the same SQL to Cloudflare D1
(SQLite-compatible). The schema is owned by ``packages/schema`` — this module
applies those migrations and provides the narrow set of reads/writes the
ingestion pipeline needs. Nothing here invents data.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .models import Snapshot, SnapshotStatus

_REPO_ROOT = Path(__file__).resolve().parents[2]
_MIGRATIONS_DIR = _REPO_ROOT / "packages" / "schema" / "migrations"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class Db:
    def __init__(self, path: str | Path = ":memory:") -> None:
        self.conn = sqlite3.connect(str(path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON;")

    # ---- schema ---------------------------------------------------------

    def apply_migrations(self, migrations_dir: Path | None = None) -> None:
        """Apply pending migrations in filename order, idempotently. Applied
        filenames are recorded so re-running against an existing DB is safe."""
        d = migrations_dir or _MIGRATIONS_DIR
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations("
            "filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        applied = {
            r["filename"]
            for r in self.conn.execute("SELECT filename FROM schema_migrations")
        }
        for sql_file in sorted(d.glob("*.sql")):
            if sql_file.name in applied:
                continue
            self.conn.executescript(sql_file.read_text(encoding="utf-8"))
            self.conn.execute(
                "INSERT INTO schema_migrations(filename, applied_at) VALUES(?,?)",
                (sql_file.name, utcnow_iso()),
            )
        self.conn.commit()

    # ---- source registry ------------------------------------------------

    def upsert_source(
        self, id: str, name: str, url: str, license: str, cadence: str, tier: int
    ) -> None:
        self.conn.execute(
            """INSERT INTO source(id,name,url,license,cadence,tier)
               VALUES(?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, url=excluded.url,
                 license=excluded.license, cadence=excluded.cadence,
                 tier=excluded.tier""",
            (id, name, url, license, cadence, tier),
        )
        self.conn.commit()

    # ---- snapshots ------------------------------------------------------

    def snapshot_exists(self, source_id: str, sha256: str) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM source_snapshot WHERE source_id=? AND sha256=?",
            (source_id, sha256),
        ).fetchone()
        return row is not None

    def latest_promoted_snapshot(self, source_id: str) -> Snapshot | None:
        row = self.conn.execute(
            """SELECT * FROM source_snapshot
               WHERE source_id=? AND status=?
               ORDER BY fetched_at DESC LIMIT 1""",
            (source_id, SnapshotStatus.PROMOTED.value),
        ).fetchone()
        return self._to_snapshot(row) if row else None

    def insert_snapshot(
        self,
        source_id: str,
        sha256: str,
        r2_key: str,
        fetched_at: str | None = None,
        status: str = SnapshotStatus.FETCHED.value,
    ) -> Snapshot:
        fetched_at = fetched_at or utcnow_iso()
        cur = self.conn.execute(
            """INSERT INTO source_snapshot(source_id,sha256,r2_key,fetched_at,status)
               VALUES(?,?,?,?,?)""",
            (source_id, sha256, r2_key, fetched_at, status),
        )
        self.conn.commit()
        row = self.conn.execute(
            "SELECT * FROM source_snapshot WHERE id=?", (cur.lastrowid,)
        ).fetchone()
        return self._to_snapshot(row)

    def set_snapshot_status(
        self, snapshot_id: int, status: str, row_count: int | None = None
    ) -> None:
        self.conn.execute(
            "UPDATE source_snapshot SET status=?, row_count=COALESCE(?,row_count) WHERE id=?",
            (status, row_count, snapshot_id),
        )
        self.conn.commit()

    # ---- staging: NPPA ceilings (S3) ------------------------------------

    def insert_staging_ceilings(self, snapshot_id: int, rows: list[dict]) -> int:
        ingested_at = utcnow_iso()
        n = 0
        for r in rows:
            self.conn.execute(
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
                    r["notification_date"],  # valid_from
                    ingested_at,
                ),
            )
            n += 1
        self.conn.commit()
        return n

    def current_staging_ceilings(self) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM staging_ceiling WHERE valid_to IS NULL ORDER BY id"
        ).fetchall()

    def find_current_ceiling(self, raw_description: str) -> sqlite3.Row | None:
        return self.conn.execute(
            """SELECT * FROM staging_ceiling
               WHERE raw_description=? AND valid_to IS NULL
               ORDER BY id LIMIT 1""",
            (raw_description,),
        ).fetchone()

    def close_current_ceilings_for_source(
        self, snapshot_id: int, valid_to: str
    ) -> int:
        """Close (set valid_to) the current-generation staging rows that belong to
        the SAME source as ``snapshot_id`` but a DIFFERENT snapshot. This is how a
        newly-promoted snapshot supersedes the previous one. Returns rows closed.

        Supersession is snapshot-scoped, not row-keyed, because parsed source rows
        have no stable per-formulation identity until the normaliser (§4.1)
        resolves them — continuation rows in the source recur verbatim."""
        cur = self.conn.execute(
            """UPDATE staging_ceiling SET valid_to=?
               WHERE valid_to IS NULL
                 AND snapshot_id != ?
                 AND snapshot_id IN (
                   SELECT id FROM source_snapshot WHERE source_id = (
                     SELECT source_id FROM source_snapshot WHERE id=?))""",
            (valid_to, snapshot_id, snapshot_id),
        )
        return cur.rowcount

    # ---- canonical: PIN centroids (S10) ---------------------------------

    def find_current_pincentroid(self, pincode: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM pin_centroid WHERE pincode=? AND valid_to IS NULL",
            (pincode,),
        ).fetchone()

    def current_pincentroids(self) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM pin_centroid WHERE valid_to IS NULL ORDER BY pincode"
        ).fetchall()

    # ---- version --------------------------------------------------------

    def next_knowledge_version(self, snapshot_ids: list[int]) -> int:
        import json

        row = self.conn.execute(
            "SELECT COALESCE(MAX(version),0)+1 AS v FROM knowledge_version"
        ).fetchone()
        version = int(row["v"])
        self.conn.execute(
            "INSERT INTO knowledge_version(version,promoted_at,snapshot_ids) VALUES(?,?,?)",
            (version, utcnow_iso(), json.dumps(snapshot_ids)),
        )
        self.conn.commit()
        return version

    # ---- helpers --------------------------------------------------------

    @staticmethod
    def _to_snapshot(row: sqlite3.Row) -> Snapshot:
        return Snapshot(
            id=row["id"],
            source_id=row["source_id"],
            sha256=row["sha256"],
            r2_key=row["r2_key"],
            fetched_at=row["fetched_at"],
            status=row["status"],
            row_count=row["row_count"],
        )

    def close(self) -> None:
        self.conn.close()
