-- Salt canonical schema — migration 0001 (initial)
-- Source of record: docs/salt-technical-design.md §2.2. Transcribed verbatim;
-- if you change this, change the design and note why.
--
-- Target: Cloudflare D1 (SQLite). Kept SQLite-portable: no engine-specific types.
-- The DB is a DERIVED artifact — rebuildable from the R2 raw store + git-versioned
-- curated judgements. Prices and ceilings are APPEND-ONLY (valid_from/valid_to);
-- never UPDATE a price row in place.

-- ============ PROVENANCE ============

CREATE TABLE source (
  id            TEXT PRIMARY KEY,        -- 'pmbjp_catalogue', 'nppa_ceiling'
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  license       TEXT NOT NULL,           -- 'GODL-India' | 'public' | 'tos-restricted'
  cadence       TEXT NOT NULL,           -- 'daily' | 'monthly' | 'event'
  tier          INTEGER NOT NULL         -- 1 = government, 2 = commercial
);

CREATE TABLE source_snapshot (
  id            INTEGER PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES source(id),
  sha256        TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  fetched_at    TEXT NOT NULL,           -- ISO8601 UTC
  status        TEXT NOT NULL,           -- fetched|parsed|quarantined|promoted
  row_count     INTEGER,
  notes         TEXT,
  UNIQUE (source_id, sha256)
);
CREATE INDEX idx_snapshot_source_time ON source_snapshot(source_id, fetched_at DESC);

-- ============ CLINICAL ONTOLOGY ============

CREATE TABLE molecule (
  id            INTEGER PRIMARY KEY,
  inn_name      TEXT NOT NULL UNIQUE,    -- 'paracetamol' (lowercased INN)
  atc_code      TEXT,                    -- nullable; useful for therapy grouping
  is_nti        INTEGER NOT NULL DEFAULT 0  -- narrow therapeutic index
);

CREATE TABLE molecule_synonym (
  molecule_id   INTEGER NOT NULL REFERENCES molecule(id),
  synonym       TEXT NOT NULL,           -- 'acetaminophen', 'paracetomol' (misspell)
  kind          TEXT NOT NULL,           -- 'inn'|'usan'|'trivial'|'misspelling'
  PRIMARY KEY (synonym)
);

-- A formulation is the canonical therapeutic unit: the thing that
-- makes two products interchangeable.
CREATE TABLE formulation (
  id            INTEGER PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,    -- see design §4.1 for construction
  dosage_form   TEXT NOT NULL,           -- tablet|capsule|syrup|injection|...
  release_type  TEXT NOT NULL,           -- IR|SR|ER|XR|CR|DR|MR
  route         TEXT NOT NULL,           -- oral|topical|parenteral|...
  is_fdc        INTEGER NOT NULL,        -- fixed-dose combination
  component_ct  INTEGER NOT NULL
);
CREATE INDEX idx_formulation_key ON formulation(canonical_key);

CREATE TABLE formulation_component (
  formulation_id INTEGER NOT NULL REFERENCES formulation(id),
  molecule_id    INTEGER NOT NULL REFERENCES molecule(id),
  strength_base  REAL NOT NULL,          -- normalised to mg (or IU, or %)
  strength_unit  TEXT NOT NULL,          -- 'mg'|'iu'|'pct'|'mg_per_ml'
  salt_form      TEXT,                   -- 'succinate','tartrate',NULL
  ordinal        INTEGER NOT NULL,       -- deterministic sort position
  PRIMARY KEY (formulation_id, ordinal)
);
CREATE INDEX idx_component_molecule ON formulation_component(molecule_id);

-- ============ COMMERCIAL LAYER ============

CREATE TABLE channel (
  id            TEXT PRIMARY KEY,        -- 'jan_aushadhi','unbranded','branded','epharmacy'
  display_name  TEXT NOT NULL,
  tier          INTEGER NOT NULL         -- ranking prior, 1 = cheapest expected
);

CREATE TABLE product (
  id              INTEGER PRIMARY KEY,
  formulation_id  INTEGER REFERENCES formulation(id),  -- NULL until resolved
  channel_id      TEXT NOT NULL REFERENCES channel(id),
  brand_name      TEXT NOT NULL,
  brand_slug      TEXT NOT NULL,
  manufacturer    TEXT,
  pack_size       REAL NOT NULL,         -- 15 (tablets) or 100 (ml)
  pack_unit       TEXT NOT NULL,         -- 'tablet'|'ml'|'gm'|'vial'
  raw_composition TEXT NOT NULL,         -- verbatim, never normalised in place
  source_id       TEXT NOT NULL REFERENCES source(id),
  first_seen      TEXT NOT NULL,
  last_seen       TEXT NOT NULL,
  status          TEXT NOT NULL          -- active|delisted|unresolved
);
CREATE UNIQUE INDEX idx_product_slug ON product(brand_slug, pack_size, pack_unit);
CREATE INDEX idx_product_formulation ON product(formulation_id) WHERE formulation_id IS NOT NULL;
CREATE INDEX idx_product_unresolved ON product(status) WHERE formulation_id IS NULL;

-- Append-only. A price change is a new row, never an UPDATE.
CREATE TABLE product_price (
  id            INTEGER PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES product(id),
  mrp           REAL NOT NULL,           -- pack price, INR
  unit_price    REAL NOT NULL,           -- mrp / pack_size, denormalised for ranking
  gst_pct       REAL,
  valid_from    TEXT NOT NULL,           -- effective date from source
  valid_to      TEXT,                    -- NULL = current
  snapshot_id   INTEGER NOT NULL REFERENCES source_snapshot(id),
  ingested_at   TEXT NOT NULL
);
CREATE INDEX idx_price_current ON product_price(product_id, valid_to)
  WHERE valid_to IS NULL;
CREATE INDEX idx_price_history ON product_price(product_id, valid_from DESC);

-- ============ REGULATORY LAYER ============

CREATE TABLE ceiling_price (
  id             INTEGER PRIMARY KEY,
  formulation_id INTEGER NOT NULL REFERENCES formulation(id),
  ceiling_per_unit REAL NOT NULL,        -- excl. GST, per DPCO
  gst_pct        REAL NOT NULL DEFAULT 12,
  notification_no TEXT NOT NULL,         -- 'S.O.3869(E)'
  notification_date TEXT NOT NULL,
  valid_from     TEXT NOT NULL,
  valid_to       TEXT,
  snapshot_id    INTEGER NOT NULL REFERENCES source_snapshot(id)
);
CREATE INDEX idx_ceiling_current ON ceiling_price(formulation_id, valid_to)
  WHERE valid_to IS NULL;

CREATE TABLE recall (
  id            INTEGER PRIMARY KEY,
  scope         TEXT NOT NULL,           -- 'batch'|'product'|'molecule'
  product_id    INTEGER REFERENCES product(id),
  batch_no      TEXT,
  issued_by     TEXT NOT NULL,           -- 'BPPI'|'CDSCO'|'State FDA'
  issued_on     TEXT NOT NULL,
  reason        TEXT,
  snapshot_id   INTEGER NOT NULL REFERENCES source_snapshot(id)
);

-- ============ GEOGRAPHY ============

CREATE TABLE outlet (
  id            INTEGER PRIMARY KEY,
  external_id   TEXT UNIQUE,             -- PMBJP kendra code
  kind          TEXT NOT NULL,           -- 'jan_aushadhi'
  name          TEXT NOT NULL,
  address       TEXT,
  pincode       TEXT NOT NULL,
  district      TEXT,
  state         TEXT,
  lat           REAL,
  lng           REAL,
  geohash7      TEXT,                    -- ~153m cell, prefix-searchable
  status        TEXT NOT NULL,           -- active|closed|unknown
  last_seen     TEXT NOT NULL
);
CREATE INDEX idx_outlet_geohash ON outlet(geohash7);
CREATE INDEX idx_outlet_pincode ON outlet(pincode);

-- ============ SAFETY ============

CREATE TABLE substitution_rule (
  id            INTEGER PRIMARY KEY,
  rule_type     TEXT NOT NULL,     -- 'nti_block'|'salt_block'|'release_block'|'form_warn'
  molecule_id   INTEGER REFERENCES molecule(id),
  verdict       TEXT NOT NULL,     -- 'allow'|'warn'|'block'
  reason_code   TEXT NOT NULL,
  citation      TEXT,              -- literature or regulatory reference
  reviewed_by   TEXT NOT NULL,     -- named clinical reviewer
  reviewed_on   TEXT NOT NULL
);

-- ============ RESOLUTION AUDIT ============

CREATE TABLE match_audit (
  id             INTEGER PRIMARY KEY,
  product_id     INTEGER NOT NULL REFERENCES product(id),
  formulation_id INTEGER REFERENCES formulation(id),
  method         TEXT NOT NULL,     -- 'deterministic'|'fuzzy'|'llm'|'human'
  confidence     REAL NOT NULL,
  evidence       TEXT NOT NULL,     -- JSON: tokens matched, scores, model used
  decided_at     TEXT NOT NULL,
  reviewed_by    TEXT
);
CREATE INDEX idx_audit_lowconf ON match_audit(confidence) WHERE confidence < 0.9;

-- ============ GLOBAL VERSION ============

CREATE TABLE knowledge_version (
  version       INTEGER PRIMARY KEY,
  promoted_at   TEXT NOT NULL,
  snapshot_ids  TEXT NOT NULL          -- JSON array
);
