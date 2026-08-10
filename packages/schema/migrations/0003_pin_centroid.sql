-- Salt schema — migration 0003 (PIN-code centroids, source S10)
-- Design §4.5 step 1: "Geocode pincode → centroid (static India PIN centroid
-- table, no API)". Unlike ceilings, a pincode IS a stable identity, so this is a
-- canonical table with proper per-pincode append-only supersession (one current
-- row per pincode; a changed centroid closes the old row and inserts a new one).
--
-- Source: GeoNames India postal export (CC-BY 4.0) — a community/tier-2 source
-- (recorded in the `source` licensing register and surfaced on /sources), chosen
-- because the official India Post open data has empty coordinates for most
-- offices. Geocoding here is approximate ("nearest kendra"), per §13.2.

CREATE TABLE pin_centroid (
  id            INTEGER PRIMARY KEY,
  pincode       TEXT NOT NULL,            -- 6-digit
  lat           REAL NOT NULL,            -- centroid of the pincode's places
  lng           REAL NOT NULL,
  place_count   INTEGER NOT NULL,         -- how many place rows were averaged
  state         TEXT,
  district      TEXT,
  source_id     TEXT NOT NULL REFERENCES source(id),
  snapshot_id   INTEGER NOT NULL REFERENCES source_snapshot(id),
  valid_from    TEXT NOT NULL,
  valid_to      TEXT,                     -- NULL = current
  ingested_at   TEXT NOT NULL
);
-- one CURRENT centroid per pincode
CREATE UNIQUE INDEX idx_pin_centroid_current
  ON pin_centroid(pincode) WHERE valid_to IS NULL;
CREATE INDEX idx_pin_centroid_snapshot ON pin_centroid(snapshot_id);
