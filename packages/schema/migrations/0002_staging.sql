-- Salt schema — migration 0002 (ingestion staging tables)
-- Source of record: docs/salt-technical-design.md §1.2 ("Parsers ──► Staging
-- tables ──► Validators ──► Promoter"). Staging holds parsed source rows BEFORE
-- they are resolved into the canonical clinical tables. Canonical promotion of
-- ceilings into `ceiling_price` requires formulation resolution (the normaliser,
-- §4.1, Milestone 4-5), which does not exist yet — so for now S3 lands here,
-- fully replayable from R2, awaiting that resolution step.

-- Parsed NPPA ceiling-price rows (S3), stored verbatim + typed. Append-only /
-- bitemporal, same discipline as canonical price rows: a change is a new row,
-- superseded rows get a valid_to; never UPDATE in place.
CREATE TABLE staging_ceiling (
  id                INTEGER PRIMARY KEY,
  snapshot_id       INTEGER NOT NULL REFERENCES source_snapshot(id),
  source_page       INTEGER,                 -- 1-indexed PDF page
  nlem_section      TEXT,                    -- e.g. '1.1.1' when the row carried one
  raw_description   TEXT NOT NULL,           -- verbatim; the normaliser (§4.1) consumes this
  ceiling_price     REAL NOT NULL,           -- Rs, as printed (per unit/pack, excl GST)
  notification_no   TEXT NOT NULL,           -- e.g. '1499(E)'
  notification_date TEXT NOT NULL,           -- ISO8601 date
  raw_line          TEXT NOT NULL,           -- verbatim full source line (provenance)
  valid_from        TEXT NOT NULL,           -- = notification_date
  valid_to          TEXT,                    -- NULL = current; set on supersede
  ingested_at       TEXT NOT NULL
);
CREATE INDEX idx_staging_ceiling_current
  ON staging_ceiling(raw_description, valid_to) WHERE valid_to IS NULL;
CREATE INDEX idx_staging_ceiling_snapshot ON staging_ceiling(snapshot_id);
