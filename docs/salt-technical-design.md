# SALT — Technical Design Report

**India's neutral medicine price index**
Master specification v1.0 · Engineering blueprint

---

# PART 0 — PRODUCT DEFINITION

## 0.1 What it is

A **read-heavy public price index for medicines in India.** Given a brand name, a molecule, or (from v1) a photographed prescription, Salt returns every therapeutically equivalent product available in India, ranked by price per unit, across four channels — Jan Aushadhi Kendras, unbranded generics, branded generics, and e-pharmacies — alongside the NPPA statutory ceiling price where one exists.

Salt does not sell, stock, dispense, or deliver medicines. It never touches inventory. This is a deliberate architectural and strategic constraint, not a phase-one limitation.

## 0.2 The user problem

A patient in India receives a prescription written in illegible handwriting using a brand name. They hand it to a pharmacist who has a margin incentive to dispense the most expensive equivalent. The patient cannot read the prescription, does not know the molecule, has no reference price, and does not know that a statutory maximum exists for many of these drugs.

Concretely: medicines are roughly two-thirds of India's out-of-pocket health spending; 29 million households face financial hardship from medicine costs alone; and the same molecule can retail at 8–35× the Jan Aushadhi price.

## 0.3 Core workflows

```
WORKFLOW A — Brand lookup (v0, no auth)
  user types "Dolo 650"
    → resolve to formulation (Paracetamol 650mg, tablet, IR)
    → fetch all products mapped to that formulation
    → normalise to per-unit price
    → apply substitution safety rules
    → rank and return ladder + ceiling comparison

WORKFLOW B — Prescription scan (v1)
  user photographs prescription
    → vision extraction → line items (molecule/brand, strength, form, qty)
    → per-line confidence scoring
    → low-confidence lines surfaced for user confirmation
    → each confirmed line runs Workflow A
    → basket total + aggregate saving

WORKFLOW C — Kendra proximity (v0)
  user enters pincode
    → nearest Jan Aushadhi outlets by geodesic distance
    → intersect with molecule availability in the PMBJP catalogue
    → present with explicit "stock unverified" state

WORKFLOW D — Overcharge check (v0)
  user enters the price they were quoted
    → compare to ceiling price + GST
    → if quoted > legal maximum, surface the delta and the NPPA
      complaint route
```

## 0.4 Value proposition

**For patients:** the only place showing every legal option *including the government's*, plus the maximum price the law permits.

**For payers (the revenue):** the only substitution engine not owned by someone selling the drug.

## 0.5 Models we adapt, and how we differ

### GoodRx — *the closest analog, mechanism replaced*

| | GoodRx | Salt |
|---|---|---|
| Core asset | Negotiated PBM contract prices | Statutory ceiling prices + public generic scheme prices |
| Monetisation | Referral fees from PBMs per fill | B2B index licensing to payers |
| Neutrality | Compromised (paid by PBMs) | Structural (paid by cost-bearers, not sellers) |
| Point of use | Coupon presented at counter | Information presented before purchase |

**Replicating:** the discovery layer — search a drug, see prices ranked, act.
**Modifying:** the price source. India has no PBMs. The equivalent rails are NPPA's DPCO ceiling prices and the PMBJP catalogue.
**Rejecting:** the coupon/referral revenue model. In India that would make us a lead-gen channel for whoever pays most, which destroys the only defensible position we have.

### Cost Plus Drugs — *philosophically aligned, structurally opposite*

Cost Plus Drugs is vertically integrated: a licensed wholesaler, manufacturer and mail-order pharmacy that prices at manufacturer acquisition cost plus a 15% markup, a ~$5 pharmacy fee and a ~$5 shipping fee, with the arithmetic printed on the invoice.

**Replicating:** the principle of *showing the arithmetic*. Every Salt price ladder must expose its provenance — which source, which snapshot date, which notification number.
**Rejecting:** vertical integration entirely. The moment Salt owns inventory it becomes Medkart or Davaindia, and its substitution engine points at its own shelf. Cost Plus can be transparent *and* integrated because it publishes its own cost basis; Salt cannot, because it would be comparing competitors' prices against its own.

### Kelley Blue Book / Zillow Zestimate — *the actual structural model*

A neutral third-party reference price that both sides of a transaction accept as authoritative, monetised by licensing the index rather than by participating in the transaction. This is the shape Salt should take. The consumer product exists to build the dataset and the brand; the index is the business.

### Explicitly not modelled on
Medkart, Davaindia, Genericart, AUM Pharmacy, Tata 1mg, PharmEasy — all retailers whose substitution engines are inventory-directed.

---

# PART 1 — SYSTEM ARCHITECTURE

## 1.1 Architectural principles

These drive every subsequent decision:

1. **Batch-ingest, serve-static.** All source data changes monthly at most. Nothing about the read path should require live external calls. This makes the entire product cacheable at the edge and drives marginal serving cost to approximately zero.
2. **Raw first, immutable forever.** Every fetch is stored byte-identical before parsing. The database is a *derived artifact* that can be rebuilt from scratch at any time. This is the single most important reliability decision in the system.
3. **Append-only price facts.** Prices are never updated in place. A price change is a new row. This gives free auditability, which matters enormously for a product whose credibility is its only moat.
4. **Fail closed on safety, fail stale on freshness.** If the substitution engine cannot determine equivalence with confidence, it says so rather than guessing. If a source is down, we serve yesterday's data with a visible staleness marker rather than an error.
5. **Provenance on every number.** No price is displayed without an attached source and effective date.

## 1.2 Four planes

```
┌──────────────────────────────────────────────────────────────────┐
│ INGESTION PLANE            (Python · GitHub Actions cron · free) │
│                                                                  │
│  Fetchers ──► Raw Store (R2, immutable, content-addressed)       │
│                  │                                               │
│                  ▼                                               │
│  Parsers ──► Staging tables ──► Validators ──► Promoter          │
└──────────────────────────────┬───────────────────────────────────┘
                               │ writes canonical tables
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ KNOWLEDGE PLANE                              (D1 / SQLite → PG)  │
│                                                                  │
│  molecule · formulation · product · product_price · ceiling      │
│  outlet · recall · substitution_rule · match_audit               │
│                                                                  │
│  Engines: Normaliser · Resolver · Equivalence · Ladder · Search   │
└──────────────────────────────┬───────────────────────────────────┘
                               │ read-only
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ SERVING PLANE                        (Cloudflare Workers · Hono) │
│                                                                  │
│  /v1/resolve · /v1/ladder · /v1/outlets · /v1/scan · /v1/search   │
│  Edge cache keyed by snapshot_version · KV for hot ladders        │
└──────────────────────────────┬───────────────────────────────────┘
                               │ HTTPS/JSON
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ INTERACTION PLANE                 (Astro SSG + islands · Pages)  │
│                                                                  │
│  ~50k programmatic SEO pages · search · ladder · scan · WhatsApp │
└──────────────────────────────────────────────────────────────────┘
```

## 1.3 Why this shape

**Decision: separate the ingestion plane from the serving plane entirely, communicating only through the database and R2.**

*Why:* ingestion is slow, bursty, Python-native (PDF parsing), and failure-prone. Serving is fast, constant, TypeScript-native, and must never fail. Coupling them means a bad gazette PDF can take down the website.

*Alternative considered:* a single Node monolith on Fly.io doing both. Simpler to reason about, one language, one deploy. Rejected because PDF table extraction in the JavaScript ecosystem is materially worse than `pdfplumber`/`camelot`, and because a monolith forces you to size compute for ingestion peaks that occur twice a month.

*Tradeoff accepted:* polyglot codebase, two deploy pipelines, and a contract boundary (the database schema) that must be versioned carefully. Mitigated by generating TypeScript types from the SQL schema so the boundary is compile-checked on the serving side.

## 1.4 End-to-end data flow, annotated

```
[1] Cron fires (GitHub Actions, 02:00 IST daily)
      │
[2] Fetcher hits source URL with conditional GET (ETag/Last-Modified)
      │  ├─ 304 Not Modified ──► exit, record heartbeat
      │  └─ 200 ──► continue
      │
[3] Compute SHA-256 of body
      │  ├─ hash already in source_snapshot ──► exit, record heartbeat
      │  └─ new hash ──► continue
      │
[4] Write raw bytes to R2: raw/{source_id}/{iso_date}/{sha256}.{ext}
    Insert source_snapshot row (status = 'fetched')
      │
[5] Parser reads from R2 (never from network), emits rows into
    staging_{entity} tagged with snapshot_id
      │
[6] Validator runs gates:
      - schema conformance
      - row-count drift vs previous snapshot (|Δ| > 20% ⇒ HALT)
      - price drift (any single price ×2 or ÷2 ⇒ flag row, HALT if >1%)
      - referential integrity against canonical tables
      │  ├─ FAIL ──► snapshot marked 'quarantined', alert, no promotion
      │  └─ PASS ──► continue
      │
[7] Promoter opens a transaction:
      - closes out superseded price rows (set valid_to)
      - inserts new price rows (valid_from = effective date)
      - bumps global snapshot_version
      - marks source_snapshot 'promoted'
      │
[8] Cache invalidation: new snapshot_version invalidates all edge
    cache keys by construction (version is part of the key)
      │
[9] Static rebuild triggered for affected SEO pages (partial, by slug)
```

**The critical property:** step 5 reads from R2, not the network. This means every parse is deterministic and replayable. If a parser bug is found six months later, you re-run it over the historical raw store and rebuild the entire knowledge plane. Nothing is ever lost to a bad parse.

---

# PART 2 — DATA ARCHITECTURE

## 2.1 Database choice

**Recommended: Cloudflare D1 (SQLite) for v0 → Neon Postgres at Stage 2.**

*Why D1 for v0:*
- The full dataset for the scheduled-formulations scope (~6,000 formulations, ~150k products, ~500k price rows) is well under 200 MB — comfortably inside D1's free tier.
- Read-only at serve time, co-located with Workers, no connection pooling problem.
- Free tier covers roughly 5 GB storage and 5 M row-reads/day, which is far beyond MVP traffic.
- SQLite's FTS5 gives full-text search with zero additional infrastructure.

*Why Postgres later:* D1 has no native geospatial types, weak analytical query support, and write-throughput ceilings that matter once crowdsourced price reports arrive. Postgres brings PostGIS, materialised views, and `pg_trgm` for fuzzy matching.

*Alternative considered:* Postgres (Neon/Supabase) from day one. Rejected for v0 because Supabase's free tier pauses after ~7 days of inactivity (fatal for an SEO site) and Neon's free tier is ~0.5 GB, and because introducing a connection-pooling layer between Workers and Postgres adds a failure mode with no v0 benefit.

*Migration path:* keep all queries in a `@salt/db` package behind a repository interface. Nothing outside that package writes SQL. Migration then means swapping one implementation, and the ingestion plane already writes standard SQL.

## 2.2 Core schema

```sql
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
  canonical_key TEXT NOT NULL UNIQUE,    -- see 4.1 for construction
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
```

## 2.3 Key modelling decisions

**Decision: `formulation` as a first-class entity, distinct from `product`.**

*Why:* interchangeability is a property of the formulation, not the brand. Modelling it explicitly means the equivalence logic is a foreign-key join rather than a runtime string comparison, and makes the price ladder a simple indexed lookup.

*Alternative:* store composition as a JSON blob on `product` and compare at query time. Rejected — it makes the core query O(n) over all products and makes it impossible to attach ceiling prices, which are defined per formulation, not per brand.

**Decision: `raw_composition` is stored verbatim and never normalised in place.**

*Why:* normalisation is a lossy, versioned transform that will have bugs. Keeping the raw string means a normaliser fix can be replayed. This is the same principle as the raw R2 store, applied at field level.

**Decision: bitemporal price rows (`valid_from`/`valid_to` + `ingested_at`).**

*Why:* two different time axes matter. `valid_from` is when the price legally took effect (an April WPI revision published in March). `ingested_at` is when we learned about it. Answering "what did we show a user on 3 March?" — which you will need for any dispute — requires both.

*Tradeoff:* every price query needs a `WHERE valid_to IS NULL` predicate, and the table grows monotonically. Handled by the partial index; at India's revision cadence the table grows by roughly the product count per year, which is trivially small.

## 2.4 Retention and deletion

| Data | Retention | Basis |
|---|---|---|
| Raw source snapshots (R2) | Indefinite | Public data; enables full rebuild |
| Canonical tables | Indefinite | Derived, rebuildable |
| Prescription images | **Discarded within 60 seconds of extraction by default** | DPDP data minimisation |
| Extracted prescription lines | Session only, unless user opts into saved history | Consent-gated |
| Saved medication history (opt-in) | Until user deletion; hard delete within 30 days | DPDP erasure right |
| Anonymised price reports (v2) | Indefinite | Aggregated, non-identifying |
| Request logs | 30 days, no image bytes, no phone numbers | Operational only |

---

# PART 3 — EXTERNAL DATA AND INGESTION

## 3.1 Source registry

| # | Source | Provides | Method | Cadence | Format | License tier | Failure fallback |
|---|---|---|---|---|---|---|---|
| S1 | PMBJP product catalogue | ~2,047 generic products, MRPs, drug codes | HTTP fetch of published list | Monthly | PDF/XLSX | Government | Serve last snapshot |
| S2 | PMBJP kendra directory | ~14,200 outlets, addresses, pincodes | Portal enumeration by state/district | Monthly | HTML/JSON | Government | Serve last snapshot |
| S3 | NPPA ceiling price notifications | 928 scheduled formulations, ceiling per unit | Gazette PDF download | On notification + annual April revision | PDF tables | Government | Serve last; alert if >45d stale |
| S4 | DoP annual WPI revision orders | Revised ceilings, revised retail prices | PDF | Annual (March, effective 1 April) | PDF | Government | Hard-fail alert — this one matters |
| S5 | Pharma Sahi Daam / IPDMS 2.0 | **Brand-level prices, scheduled + non-scheduled** | Portal enumeration | Monthly | HTML | Government | Degrade to formulation-level only |
| S6 | NLEM 2022 list | Essentiality flag, scope of ceiling regime | PDF | Rare | PDF | Government | Static file |
| S7 | BPPI recall notices | Withdrawn batches | Portal/notices | Event-driven | HTML/PDF | Government | Show no recalls; never claim "no recalls exist" |
| S8 | CDSCO approved FDC list | Legal FDC combinations | PDF/portal | Quarterly | PDF | Government | Optional enrichment |
| S9 | E-pharmacy catalogues (v1) | Long-tail brand→composition, live MRP | Crawl | Weekly | HTML | **Commercial ToS** | Drop channel; ladder still valid |
| S10 | Postal PIN code centroids | Geocoding without an API | Bulk download | Rare | CSV | Government | Static file |

**Decision: v0 uses only S1–S8 and S10.** All are government sources under India's open data framing. S9 is deferred to v1 as a separate, clearly-labelled channel that can be switched off without breaking the product.

*Why:* it makes the entire v0 legally unambiguous, keeps ingestion cost at zero, and — because scheduled formulations are overwhelmingly chronic-disease drugs — covers the highest-value use case. It also means a government partnership conversation is possible without first explaining why we scrape competitors.

## 3.2 The critical unknown: S5 enumerability

Pharma Sahi Daam is a search interface, not a bulk download or API. Before any code is written, one engineer should spend an afternoon determining:

1. Does it accept wildcard or alphabetical enumeration, or only exact-name lookup?
2. Is there a captcha, and at what request rate does throttling begin?
3. Are results paginated with stable cursors?
4. Is there an undocumented JSON endpoint behind the HTML form? (Check the network tab — government portals frequently have one.)

**If enumerable:** brand-level pricing is free, government-sourced, and legally clean. This is the good case and should be assumed in planning.

**If not enumerable:** fall back to a *reverse* strategy — for each formulation in S3, query S5 by molecule name to retrieve the brands mapped to it. This yields brand coverage limited to scheduled formulations, which is exactly the v0 scope anyway. S9 then becomes necessary earlier for the long tail.

This is the single highest-leverage unknown in the build. Resolve it in week 1.

## 3.3 Ingestion component design

```python
# Every source implements this interface. No exceptions.

class Source(Protocol):
    id: str
    cadence: Cadence

    def fetch(self, ctx: FetchContext) -> list[RawArtifact]:
        """Network I/O ONLY. Conditional GET. No parsing.
           Must be idempotent and safe to retry."""

    def parse(self, artifact: RawArtifact) -> Iterator[StagedRow]:
        """Pure function of bytes → rows. NO network access.
           Must be deterministic: same bytes ⇒ same rows."""

    def validate(self, rows: list[StagedRow], prev: Snapshot | None) -> ValidationReport:
        """Source-specific sanity gates beyond the generic ones."""
```

The `parse` purity constraint is what makes historical replay possible. It should be enforced in tests by running parsers with network access disabled.

### 3.3.1 Fetcher

```python
def fetch_with_dedup(source: Source, ctx) -> Snapshot | None:
    prev = db.latest_snapshot(source.id)
    headers = {}
    if prev and prev.etag:
        headers["If-None-Match"] = prev.etag
    if prev and prev.last_modified:
        headers["If-Modified-Since"] = prev.last_modified

    resp = http.get(source.url, headers=headers,
                    timeout=30, retries=5, backoff="exponential+jitter")

    if resp.status == 304:
        db.record_heartbeat(source.id, "unchanged")
        return None

    digest = sha256(resp.content)
    if db.snapshot_exists(source.id, digest):
        db.record_heartbeat(source.id, "unchanged_by_hash")
        return None

    key = f"raw/{source.id}/{today()}/{digest}.{ext(resp)}"
    r2.put(key, resp.content, immutable=True)
    return db.insert_snapshot(source.id, digest, key, resp.headers)
```

Content-hash deduplication before parse is what keeps ingestion cost near zero: most days, nothing has changed and the pipeline exits in under a second.

### 3.3.2 Validation gates

Generic gates applied to every source:

| Gate | Rule | On failure |
|---|---|---|
| Schema | All required columns present, types coercible | Quarantine snapshot |
| Row-count drift | \|Δrows\| ≤ 20% vs previous promoted snapshot | Quarantine + alert |
| Null explosion | Nulls in any required column ≤ 2% | Quarantine |
| Price sanity | 0 < price < ₹500,000; per-unit price < pack MRP | Drop row, flag |
| Price drift | No single product's price changes by >2× | Flag row; quarantine if >1% of rows affected |
| Referential | Every FK resolves | Quarantine |
| Encoding | Valid UTF-8, no mojibake signatures | Quarantine |

**Decision: quarantine and halt rather than partial-promote.**

*Why:* a partially-promoted snapshot produces a database in a state that never existed at the source, which is unauditable. Better to serve data that is 30 days stale and correct than 1 day stale and internally inconsistent.

*Tradeoff:* one malformed gazette PDF blocks the whole source until a human intervenes. Acceptable at this cadence; the alert routes to a human within an hour.

### 3.3.3 Promotion

```python
def promote(snapshot: Snapshot):
    with db.transaction():
        version = db.next_knowledge_version()
        for row in staging.rows(snapshot.id):
            existing = db.current_price(row.product_id)
            if existing and existing.mrp == row.mrp:
                db.touch_last_seen(row.product_id)      # no new row
                continue
            if existing:
                db.close_price(existing.id, valid_to=row.valid_from)
            db.insert_price(row, snapshot_id=snapshot.id, version=version)
        db.mark_promoted(snapshot.id, version)
    cache.publish_version(version)   # invalidates edge cache by key change
    static_rebuild.enqueue(affected_slugs(snapshot))
```

Note the no-op path: if the price is unchanged, we update `last_seen` rather than inserting a duplicate row. This keeps the append-only table from growing on every ingest cycle.

---

# PART 4 — CORE ENGINES

This section is the actual product. Everything else is plumbing.

## 4.1 Composition Normalisation Engine

**Job:** turn `"Metformin HCl 500mg + Glimepiride 2mg SR Tablet"` into a deterministic canonical key.

```
INPUT   raw_composition: string, dosage_form_hint: string?
OUTPUT  CanonicalFormulation | NormalisationFailure
```

### Algorithm

```
1. LOWERCASE, strip punctuation except '+', '/', '.', digits, unit chars
2. SPLIT into components on: '+', '&', ' and ', ','
   (careful: commas also appear inside numbers — split only on
    commas not flanked by digits)
3. For each component:
   3a. EXTRACT strength via regex family:
       (\d+\.?\d*)\s*(mg|mcg|µg|g|ml|iu|%|mg/ml|mg/5ml)
       Take the LAST match in the component (leading numbers are
       often part of brand names, e.g. "Dolo 650")
   3b. NORMALISE unit → base:
       mcg,µg → mg (÷1000);  g → mg (×1000);
       %  → keep as 'pct';   IU → keep as 'iu';
       mg/5ml → mg_per_ml (÷5)
   3c. EXTRACT salt form from a curated suffix dictionary:
       {hydrochloride, hcl, sodium, potassium, succinate, tartrate,
        maleate, besylate, mesylate, fumarate, dihydrate, ...}
       → store separately; DO NOT discard
   3d. RESOLVE remaining token to molecule_id via molecule_synonym
       exact match → trigram match (threshold 0.85) → FAIL
4. EXTRACT dosage_form from form dictionary
5. EXTRACT release_type from modifier dictionary:
   {sr, xr, er, cr, dr, mr, la, xl, retard} → else IR
6. SORT components by (molecule_id ASC)   ← determinism requirement
7. BUILD canonical_key:
   "{form}|{release}|" + ";".join(
       f"{mol_id}:{strength_base}:{unit}:{salt or '-'}"
       for c in sorted_components)
8. If ANY component fails resolution → return NormalisationFailure
   (partial normalisation is forbidden — a half-resolved FDC is a
    safety hazard)
```

### The three cases that will break naive implementations

1. **Brand names containing numbers.** "Dolo 650", "Combiflam 400", "Telma 40". Rule 3a's *last-match* heuristic handles most, but "Glycomet-GP 2" means glimepiride 2mg with an implicit metformin 500mg — the strength is positional and brand-specific. These require a curated override table. Budget ~200 hand-written overrides for the top brands; they cover a disproportionate share of volume.

2. **Salt forms that are not interchangeable.** Metoprolol succinate (extended-release cardiac use) and metoprolol tartrate (immediate-release) are clinically distinct. Discarding the salt to "simplify" matching is the single most dangerous shortcut available in this system. Salt is part of the canonical key.

3. **Modified-release equivalence.** A 500 mg SR tablet is not substitutable for a 500 mg IR tablet. `release_type` is part of the canonical key, not metadata.

### Testing

Property-based tests with Hypothesis:
- `normalise(x) == normalise(x)` (determinism)
- `normalise(reorder_components(x)) == normalise(x)` (order invariance)
- `normalise(x).components.length == count_molecules(x)` (no silent drops)

Plus a golden corpus of 1,000 hand-labelled composition strings sampled by *volume*, not uniformly — the top 500 brands by prescription volume matter more than the long tail.

## 4.2 Brand → Formulation Resolver

**Job:** map ~150k product rows to formulations, at acceptable cost and known accuracy.

**Decision: a three-tier cascade, cheapest tier first, with confidence gating.**

```
TIER 1 — DETERMINISTIC (target: 70–80% of rows, cost ₹0)
  Normalise raw_composition (§4.1). If it produces a canonical_key
  that exists in `formulation`, match with confidence 1.0.
  Also: exact match on manufacturer + brand + pack against a
  previously-resolved product.

TIER 2 — FUZZY (target: 10–15%, cost ₹0)
  Blocking: candidate formulations sharing ≥1 resolved molecule
            AND same dosage_form AND same component_count.
  Scoring:  weighted sum of
              0.50 × molecule-set Jaccard
              0.30 × strength vector cosine (log-scaled)
              0.10 × form exact match
              0.10 × release exact match
  Accept if score ≥ 0.92 AND margin over runner-up ≥ 0.08.
  Otherwise → Tier 3.

TIER 3 — LLM ADJUDICATION (target: 5–10%, cost ~₹0.05/row)
  Prompt: raw composition string + top-5 Tier-2 candidates,
          constrained JSON output {choice_id | "none", confidence,
          reasoning}. Temperature 0.
  Accept only if model confidence ≥ 0.9 AND choice is in the
  candidate set (never allow free-form invention).
  Otherwise → human review queue.

HUMAN REVIEW QUEUE
  Everything unresolved, plus a 2% random audit sample of Tier 1
  and Tier 2 accepts. Sorted by prescription volume descending, so
  the highest-impact ambiguities get reviewed first.
```

Every decision writes a `match_audit` row with method, confidence and evidence. This makes accuracy measurable and regressions detectable.

**Decision: LLM is an adjudicator constrained to a candidate set, never a generator.**

*Why:* an unconstrained model will confidently invent a plausible-sounding molecule mapping. Constraining it to choose among candidates produced by deterministic logic bounds the failure mode to "picks the wrong one of five" rather than "hallucinates a drug."

*Alternative:* embed compositions and use vector similarity throughout. Rejected as the primary method — embeddings blur exactly the distinctions that matter clinically (500 mg vs 50 mg, succinate vs tartrate embed almost identically). Vector search is fine for the *search box*, not for equivalence.

*Cost at scale:* 150k rows × 10% × ₹0.05 ≈ ₹750 for a full resolution pass. Incremental passes cost a fraction of that.

## 4.3 Equivalence and Substitution Safety Engine

**Job:** given a source formulation and a candidate, return a verdict a pharmacist would defend.

```typescript
type Verdict = 'INTERCHANGEABLE' | 'CONSULT_REQUIRED' | 'NOT_INTERCHANGEABLE';

interface EquivalenceResult {
  verdict: Verdict;
  reasonCode: string;
  displayMessage: string;
  ruleIds: number[];      // auditable
}

function assessEquivalence(src: Formulation, cand: Formulation): EquivalenceResult {
  // Gate 1 — molecule set must match exactly.
  if (!setEqual(molecules(src), molecules(cand)))
    return block('MOLECULE_MISMATCH');

  // Gate 2 — strengths must match exactly, per component.
  if (!strengthsEqual(src, cand))
    return block('STRENGTH_MISMATCH');

  // Gate 3 — NTI drugs are never auto-substituted.
  //          Price is still shown; the switch is not endorsed.
  if (src.components.some(c => c.molecule.isNti))
    return consult('NTI_DRUG',
      'This medicine needs consistent blood levels. ' +
      'Ask your doctor before switching brands.');

  // Gate 4 — release profile must match.
  if (src.releaseType !== cand.releaseType)
    return block('RELEASE_MISMATCH');

  // Gate 5 — salt form. Same salt = fine. Different salt = clinician call.
  if (!saltFormsEqual(src, cand))
    return consult('SALT_FORM_DIFFERS',
      'Different salt form of the same molecule. Confirm with your doctor.');

  // Gate 6 — dosage form. Tablet↔capsule is usually fine orally;
  //          anything crossing route is not.
  if (src.route !== cand.route)
    return block('ROUTE_MISMATCH');
  if (src.dosageForm !== cand.dosageForm && !ORAL_SOLID.has(both))
    return consult('FORM_DIFFERS');

  // Gate 7 — active recall on the candidate.
  if (hasActiveRecall(cand))
    return block('ACTIVE_RECALL');

  return allow('EXACT_MATCH');
}
```

### The NTI list

Curated once, reviewed by a named pharmacist, versioned in the repository, and cited. Minimum set: warfarin, levothyroxine, phenytoin, carbamazepine, valproate, lithium, digoxin, theophylline, ciclosporin, tacrolimus, sirolimus, mycophenolate, procainamide, and all antiretrovirals and anti-tubercular fixed-dose combinations.

**Decision: NTI drugs show the price ladder but with `CONSULT_REQUIRED` and no "switch and save" call to action.**

*Why:* suppressing the information entirely is paternalistic and removes value for the user's conversation with their doctor. But an app-driven brand switch on warfarin is a bleeding risk. Show, don't nudge.

### Kill switch

A single feature flag in KV, `substitution_engine_enabled`, that degrades the product to pure price display with no equivalence claims. If a safety incident occurs, this must be flippable in under 60 seconds without a deploy.

## 4.4 Price Ladder Engine

```
INPUT  formulation_id, quantity_needed, pincode?, quoted_price?
OUTPUT ranked ladder + ceiling comparison + saving
```

```typescript
async function buildLadder(input: LadderInput): Promise<Ladder> {
  const src = await repo.formulation(input.formulationId);

  // 1. Fetch all products on this formulation with a current price.
  const products = await repo.currentPricesForFormulation(src.id);

  // 2. Assess each candidate. Blocked candidates are dropped, not hidden —
  //    they appear in a separate "not interchangeable" section.
  const assessed = products.map(p => ({
    product: p,
    equivalence: assessEquivalence(src, p.formulation),
  }));

  // 3. Normalise to comparable units: cost for the quantity needed,
  //    accounting for pack size (you cannot buy 7 tablets of a 15-pack).
  const priced = assessed.map(a => {
    const packsNeeded = Math.ceil(input.quantityNeeded / a.product.packSize);
    return {
      ...a,
      unitPrice: a.product.mrp / a.product.packSize,
      effectiveCost: packsNeeded * a.product.mrp,
      packsNeeded,
      wastage: packsNeeded * a.product.packSize - input.quantityNeeded,
    };
  });

  // 4. Rank. Deterministic, no personalisation, tie-broken stably.
  const rank = (x) =>
    [ x.equivalence.verdict === 'NOT_INTERCHANGEABLE' ? 1 : 0,
      x.effectiveCost,
      x.unitPrice,
      CHANNEL_TIER[x.product.channelId],
      x.product.id ];                       // stable final tiebreak

  priced.sort(byTuple(rank));

  // 5. Ceiling comparison.
  const ceiling = await repo.currentCeiling(src.id);
  const legalMax = ceiling
    ? ceiling.ceilingPerUnit * (1 + ceiling.gstPct / 100)
    : null;

  // 6. Overcharge assessment against what the user was quoted.
  const overcharge = (input.quotedPrice && legalMax)
    ? computeOvercharge(input.quotedPrice, input.quantityNeeded, legalMax)
    : null;

  // 7. Kendra availability — presence in the PMBJP catalogue only.
  //    NEVER represented as live stock.
  const kendras = input.pincode
    ? await findNearbyKendras(input.pincode, src.id, { limit: 5 })
    : [];

  return {
    formulation: src,
    ladder: priced,
    legalMaxPerUnit: legalMax,
    ceilingCitation: ceiling?.notificationNo,
    overcharge,
    kendras,
    asOf: await repo.knowledgeVersionDate(),
    provenance: priced.map(p => p.product.sourceId),
  };
}
```

**Decision: rank by `effectiveCost` (packs you must actually buy), not `unitPrice`.**

*Why:* a cheaper per-tablet price in a 100-tablet pack is worse for someone who needs 10 tablets. Ranking by unit price produces recommendations that are arithmetically correct and practically wrong — and users notice immediately, which costs trust.

*Tradeoff:* results become quantity-dependent, so the ladder cannot be fully precomputed per formulation. Mitigated by precomputing for the three most common quantities (10, 15, 30) and computing others on demand at the edge, which is microseconds of arithmetic over a cached product list.

**Decision: no personalisation in ranking, ever.**

*Why:* the entire product is a claim to neutrality. Any per-user ranking variation — even benign — makes that claim unverifiable. A given formulation + quantity + pincode must produce a byte-identical ladder for every user. This is also what makes edge caching trivially effective.

## 4.5 Geo / Kendra Proximity

**Decision: geohash-7 prefix search with in-memory haversine refinement.**

```
1. Geocode pincode → centroid (static India PIN centroid table, no API)
2. Compute geohash-7 of centroid (~153m × 153m cell)
3. Query outlets WHERE geohash7 LIKE prefix(5) || '%'   -- ~5km box
   (expand to prefix(4) ~20km if fewer than 5 results)
4. Compute exact haversine distance for the returned set
5. Sort, take top N
```

*Why:* D1 has no geospatial extension. Geohash prefix matching turns proximity into a B-tree range scan, which SQLite does well. With ~14,200 outlets nationally, any candidate set is small enough for exact distance computation in application code.

*Alternative:* PostGIS with a GiST index. Correct, standard, and unnecessary at this row count. Adopt it when migrating to Postgres in Stage 2 and when outlet count grows by an order of magnitude (i.e. if private pharmacies are ever added).

*Tradeoff:* geohash cells distort near cell boundaries — an outlet 100m away across a boundary can be missed at a given prefix length. Mitigated by always querying the centre cell plus its eight neighbours.

## 4.6 Prescription OCR Pipeline (v1)

**Decision: a two-stage cascade with mandatory human confirmation below threshold. Never auto-accept a low-confidence line.**

```
1. CLIENT-SIDE PREPROCESS (free, reduces token cost ~40%)
   - Downscale longest edge to 1600px
   - Grayscale, adaptive contrast normalisation
   - Auto-rotate via EXIF; optional perspective correction
   - Reject images below a sharpness threshold BEFORE upload
     (Laplacian variance) — "photo is blurry, retake"

2. STAGE A — CHEAP VISION MODEL
   Constrained JSON output:
     { lines: [{ raw_text, drug_token, strength, form, frequency,
                 duration, quantity, confidence }],
       overall_confidence, is_prescription: bool }
   - If is_prescription == false → reject, do not process
   - If overall_confidence ≥ 0.85 AND every line ≥ 0.80 → accept

3. STAGE B — ESCALATION (only for lines below threshold)
   Re-run the failing lines against a stronger model, with the
   already-extracted context as a hint. Cost incurred only on the
   hard lines, typically 15–25% of them.

4. RESOLUTION
   Each drug_token → Resolver (§4.2). Note this is a different
   input distribution from catalogue text: handwriting produces
   misspellings, so the synonym table must include a curated
   misspelling set for high-volume drugs.

5. USER CONFIRMATION UI
   Every line rendered next to its cropped image region, with an
   edit affordance. Lines below threshold are pre-focused and
   cannot be skipped. No basket is computed until all lines are
   either confirmed or explicitly dismissed.

6. DISPOSAL
   Image bytes deleted within 60 seconds of extraction unless the
   user has opted into saved history. Deletion is logged.
```

**Decision: the confirmation step is non-skippable, and this is a product decision, not a technical one.**

*Why:* the failure mode of silent misextraction is a patient buying the wrong drug. Making confirmation friction-free but mandatory converts a safety risk into a UX cost. The crop-region display is what makes it fast — the user is verifying, not re-entering.

*Cost model:* ~₹0.20–0.90 per scan depending on escalation rate. At 50k scans/month this is ₹10,000–45,000/month, which is the dominant variable cost in the entire system and the reason B2B revenue must arrive before consumer scale does.

## 4.7 Search

**Decision: SQLite FTS5 with a custom tokeniser and a trigram fallback.**

```sql
CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type,       -- 'product' | 'molecule' | 'formulation'
  entity_id UNINDEXED,
  display_name,
  aliases,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

Query routing:

```
query → normalise (lowercase, collapse whitespace)
      → if matches /^\d{6}$/          → pincode route
      → if exact hit in molecule_synonym → molecule route
      → FTS5 MATCH with prefix expansion → product route
      → if zero results, trigram similarity ≥ 0.6 → "did you mean"
      → else → no-results page with a "tell us what you were looking
               for" capture (this feeds the synonym table)
```

*Why FTS5:* zero additional infrastructure, ships inside the database, sub-millisecond on this corpus size.

*Alternative:* Typesense or Meilisearch. Better typo tolerance and faceting, but introduces a stateful service to run, sync and pay for. Adopt at Stage 2 when the corpus exceeds ~500k documents or when faceted therapeutic-class browsing becomes a product requirement.

*Tradeoff:* FTS5's typo tolerance is weak. Mitigated by the curated misspelling synonym table, which is needed for OCR anyway — one investment, two payoffs.

---

# PART 5 — BACKEND

## 5.1 Runtime

**Recommended: Cloudflare Workers with Hono.**

*Why:*
- Co-located with D1, so database reads have no network hop.
- Free tier covers ~100k requests/day, comfortably beyond MVP.
- No cold starts, no container management, no scaling configuration.
- Edge cache integration is native, which matters because ~95% of traffic should never reach application code.

*Alternatives:*

| Option | Pro | Con | Verdict |
|---|---|---|---|
| Node/Fastify on Fly.io | Full Node API, easy local dev, any library | Always-on cost, cold starts on scale-to-zero, manual scaling | Reconsider at Stage 3 for the B2B API |
| Vercel Functions | Excellent Next.js integration | Commercial use on the free tier is restricted; egress pricing | No |
| AWS Lambda + API Gateway | Mature, granular | Cold starts, more configuration, cost complexity | Over-engineered for v0 |

*Tradeoff accepted:* Workers has a constrained runtime (no arbitrary npm packages needing Node built-ins, CPU-time limits per request). The ladder computation is arithmetic over a small set, well inside limits. Anything heavy — OCR, ingestion — runs outside Workers by design.

## 5.2 API surface

Versioned under `/v1`. All responses include `asOf` and `knowledgeVersion` so clients can reason about staleness.

```
GET  /v1/search?q={string}&limit={n}
     → { results: [{ type, id, displayName, subtitle, slug }] }

GET  /v1/product/{slug}
     → { product, formulation, currentPrice, priceHistory[] }

GET  /v1/ladder
     ?formulation={id} | ?product={slug}
     &quantity={n}&pincode={6-digit}&quoted={rupees}
     → { formulation, ladder[], legalMaxPerUnit, ceilingCitation,
         overcharge, kendras[], asOf, knowledgeVersion }

GET  /v1/molecule/{slug}
     → { molecule, formulations[], brandCount, priceRange }

GET  /v1/outlets?pincode={6}&formulation={id}&radius={km}
     → { outlets[], stockDisclaimer: "catalogue_only" }

POST /v1/scan                                    (v1)
     multipart: image
     → 202 { jobId }            — async, OCR exceeds request budget
GET  /v1/scan/{jobId}
     → { status, lines[], requiresConfirmation[] }

POST /v1/basket/ladder                           (v1)
     { lines: [{ formulationId, quantity }], pincode }
     → { perLine[], totals, aggregateSaving }

GET  /v1/meta/health
     → { knowledgeVersion, sources: [{ id, lastPromoted, staleDays,
                                       status }] }
```

### Response envelope

```json
{
  "data": { },
  "meta": {
    "knowledgeVersion": 1847,
    "asOf": "2026-08-01T00:00:00Z",
    "staleness": { "worstSourceDays": 3, "degraded": false }
  },
  "provenance": [
    { "field": "ladder[0].mrp", "sourceId": "pmbjp_catalogue",
      "snapshotDate": "2026-07-28" }
  ]
}
```

**Decision: ship a `provenance` block on every price-bearing response, including the public consumer API.**

*Why:* it is the technical expression of the neutrality claim, it is what a B2B customer will demand in due diligence, and building it in later means retrofitting every handler. It costs a few hundred bytes.

## 5.3 Request lifecycle

```
Client
  │  GET /v1/ladder?formulation=4412&quantity=30&pincode=560034
  ▼
Cloudflare edge
  │  cache key = sha1(path + sorted(query) + knowledgeVersion)
  ├─ HIT (≈95%) ─────────────────────────────► return, 0 origin cost
  └─ MISS
       ▼
     Worker
       │ 1. Validate + coerce params (zod). Reject unknown params.
       │ 2. Rate limit check (KV counter, sliding window)
       │ 3. Read knowledgeVersion from KV (cached 60s)
       │ 4. Try KV hot-ladder: `ladder:{v}:{form}:{qty}:{pin3}`
       │    ├─ HIT ──► serialise, return
       │    └─ MISS
       │        ▼
       │      D1 queries (3, all indexed):
       │        a. products + current prices for formulation
       │        b. current ceiling for formulation
       │        c. outlets by geohash prefix
       │        ▼
       │      Engines: assessEquivalence → buildLadder
       │        ▼
       │      Write KV (TTL 24h, but version-keyed so effectively
       │      invalidated on promote)
       │ 5. Set Cache-Control: public, max-age=3600,
       │    stale-while-revalidate=86400
       ▼
     Response
```

**Decision: `knowledgeVersion` is part of every cache key.**

*Why:* it makes cache invalidation a non-problem. Promoting a new snapshot bumps the version, which changes every key, which means the old cache entries simply age out. No purge API, no invalidation bugs, no risk of serving a stale price after a ceiling revision.

*Tradeoff:* a promotion causes a full cache cold-start. At monthly cadence and this traffic profile, that is a non-event. If it ever matters, warm the top 1,000 ladders immediately after promotion.

## 5.4 Background jobs

| Job | Trigger | Runtime | Why there |
|---|---|---|---|
| Source fetch + parse + validate | GitHub Actions cron, 02:00 IST | Python | Free minutes on public repos; Python PDF tooling |
| Promotion | Chained after validation passes | Python | Same transaction context |
| Static page rebuild | Webhook after promotion | Cloudflare Pages build | Only affected slugs |
| OCR processing | Cloudflare Queues (v1) | Worker + external model API | Exceeds request CPU budget |
| Resolver backfill | Manual / weekly | Python | Batch, cost-controlled |
| Human review queue export | Daily | Python | Feeds an internal tool |

**Decision: ingestion cron lives in GitHub Actions, not Cloudflare Cron Triggers.**

*Why:* GitHub Actions gives unlimited minutes on public repositories, a full Python environment, generous per-job timeouts, and built-in log retention and manual re-run. Cloudflare Cron Triggers run inside the Workers runtime, which is the wrong environment for PDF parsing.

*Tradeoff:* the ingestion pipeline runs from GitHub's datacenter IP ranges, which some government portals block. If that occurs, move fetching to a free-tier VM (Oracle Cloud Always Free ARM) while keeping parsing in Actions. Design the fetcher to be relocatable — it writes to R2, so nothing downstream cares where it ran.

## 5.5 Rate limiting, retries, errors

**Rate limiting.** Sliding-window counters in KV, keyed by IP for anonymous traffic and by API key for B2B. Public read endpoints: 60 req/min. `/v1/scan`: 10/hour anonymous, 100/hour authenticated. Return `429` with `Retry-After`.

**Retries.** Only outbound calls retry, never inbound-triggered writes. Exponential backoff with full jitter, five attempts, 30s cap. A circuit breaker per source opens after five consecutive failures and half-opens after one hour.

**Error taxonomy.**

| Class | HTTP | Behaviour |
|---|---|---|
| Validation | 400 | Structured field errors, no retry |
| Not found | 404 | Suggest alternatives from search |
| Rate limited | 429 | `Retry-After` header |
| Unresolvable formulation | 200 | Success with `resolvable: false` and an explanation — *not* an error; the user asked a valid question we cannot yet answer |
| Upstream stale | 200 | Success with `staleness.degraded: true` |
| Internal | 500 | Generic message, correlation ID, Sentry capture |

**Decision: staleness and unresolvability are `200` responses with metadata, not errors.**

*Why:* they are normal states of a system built on periodically-refreshed public data. Modelling them as errors pushes clients into exception handling for the common case and makes the frontend more likely to show a scary blank screen than a useful partial answer.

## 5.6 Concurrency

The system is effectively single-writer. One ingestion job writes at a time, enforced by a GitHub Actions concurrency group per source plus an advisory lock row in D1. Serving is read-only. This eliminates the entire class of write-contention problems for free, and is a deliberate design choice worth preserving as long as possible.

The exception is v2 crowdsourced price reports, which are user-initiated writes. Those go to an append-only `price_report` table with no read-modify-write, so they remain contention-free.

---

# PART 6 — FRONTEND

## 6.1 Architecture

**Recommended: Astro with island hydration, deployed to Cloudflare Pages.**

*Why:*
- The product is ~50,000 largely-static SEO pages with small dynamic regions. Astro ships zero JavaScript by default and hydrates only the islands that need it.
- Core Web Vitals directly determine the SEO strategy, which is the entire go-to-market. Astro's default output is close to optimal.
- Build-time data fetching from D1 for static content; runtime fetch for pincode-dependent pricing.

*Alternatives:*

| Option | Pro | Con | Verdict |
|---|---|---|---|
| Next.js App Router | Largest ecosystem, ISR | Heavier JS baseline; Cloudflare deployment via OpenNext adds a layer | Viable; choose if the team already knows it well |
| SvelteKit | Small bundles, good DX | Smaller ecosystem | Viable |
| Pure SPA (Vite + React) | Simplest mental model | Catastrophic for SEO | No |

*Tradeoff:* Astro's ecosystem for complex interactive state is thinner. Mitigated by the fact that only two views are genuinely interactive (scan and basket), which can be React islands inside Astro.

## 6.2 Page inventory

| Route | Rendering | Purpose |
|---|---|---|
| `/` | Static | Search entry, value proposition |
| `/medicine/{brand-slug}` | Static shell + price island | **The SEO workhorse.** ~50k pages. "Dolo 650 price and generic alternatives" |
| `/molecule/{molecule-slug}` | Static shell + island | All formulations and brands of a molecule |
| `/compare?a={}&b={}` | Edge-rendered | Direct two-product comparison |
| `/kendra/{pincode}` | Static (generated for ~19k pincodes) | Local Jan Aushadhi discovery; strong local-SEO surface |
| `/check-price` | Client island | Overcharge checker: enter what you paid |
| `/scan` | Client island (v1) | Prescription capture and confirmation |
| `/basket` | Client island (v1) | Multi-line totals |
| `/methodology` | Static | How prices are sourced, how ranking works, how to dispute |
| `/sources` | Static, generated | Live source freshness table — public, deliberately |

**Decision: publish the source freshness table publicly at `/sources`.**

*Why:* it is the cheapest possible demonstration of the neutrality claim and it pre-empts the "your data is stale" objection by owning it. It also doubles as an operational dashboard.

## 6.3 The medicine page — layout and rationale

```
┌────────────────────────────────────────────────┐
│ DOLO 650                                       │
│ Paracetamol 650mg · Tablet · 15 tablets        │
│ ₹31.50  (₹2.10 per tablet)                     │
│ Micro Labs · Prices as of 28 July 2026    [i]  │
├────────────────────────────────────────────────┤
│ ⚖  LEGAL MAXIMUM: ₹2.34 per tablet             │
│    NPPA notification S.O.3869(E)          [i]  │
├────────────────────────────────────────────────┤
│ SAME MEDICINE, LOWER PRICE                     │
│ For 30 tablets:                                │
│                                                │
│ ① Jan Aushadhi        ₹ 8.40   save ₹54.60  ✓  │
│    Paracetamol 650mg · 2 kendras within 3km    │
│    ⓘ Availability not verified — call ahead    │
│                                                │
│ ② Generic (Cipla)     ₹22.00   save ₹41.00  ✓  │
│ ③ Calpol 650          ₹58.00   —             ✓ │
├────────────────────────────────────────────────┤
│ ⓘ Price information only, not medical advice.  │
│   Talk to your doctor or pharmacist before     │
│   changing any medicine.                       │
├────────────────────────────────────────────────┤
│ Where these prices come from        [expand]   │
└────────────────────────────────────────────────┘
```

Three UX-critical properties:

1. **The legal maximum is above the fold and visually distinct.** It is the one number no competitor shows and the one that converts a browsing user into a returning one.
2. **Availability is explicitly unverified.** Routing someone to an empty kendra is the highest-frequency trust-destroying event available. Never imply stock certainty.
3. **Provenance is one tap away on every number.** Not buried in a methodology page.

## 6.4 State management

**Decision: URL as the primary state store; minimal client state.**

- Pincode, quantity, and comparison selections live in query parameters. Every view is shareable and back-button-correct.
- Pincode is additionally persisted to `localStorage` and read on hydration for convenience.
- `nanostores` (Astro-native) for the three pieces of genuinely client-side state: pincode, basket, language.
- TanStack Query for the two async views (scan, basket) — retry, dedupe, and stale-while-revalidate for free.

*Why:* URL-as-state means the CDN can cache full responses and users can share a specific price comparison. Both matter for a search-driven product.

## 6.5 Authentication

**v0: none.** No accounts, no login, no cookies beyond a functional pincode preference. This is a strategic choice — the SEO funnel converts far better without a wall, and having no user database eliminates the entire DPDP compliance surface for the first six months.

**v1: phone OTP, optional.** Required only for saved medication history and refill reminders. Delivered over WhatsApp authentication templates (roughly ₹0.13 each) with SMS fallback. Session as a signed, httpOnly, 30-day JWT; refresh on use.

**B2B: API keys** with scoped permissions and per-key rate limits, rotated on request, hashed at rest.

## 6.6 Internationalisation

Architecture from day one, content later. All strings in `messages/{locale}.json`, routes prefixed `/{locale}/`, `hreflang` tags emitted, `en` as fallback. Launch English; add Hindi at the first sign of organic Hindi query traffic, then Marathi, Tamil, Telugu, Bengali, Kannada in order of measured demand.

Drug names are **never** translated — only transliterated — and the transliteration is stored as a synonym so search works in either script.

## 6.7 Performance budget

Non-negotiable, because the users who need this most are on slow connections and cheap Android devices:

| Metric | Budget |
|---|---|
| JS shipped on a medicine page | < 30 KB gzipped |
| LCP on 3G, mid-range Android | < 2.5 s |
| Total page weight | < 150 KB |
| Time to interactive ladder | < 1.5 s |

Enforced in CI via Lighthouse budget assertions that fail the build.

---

# PART 7 — INTEGRATIONS

| Concern | Choice | Rationale | Cost | Fallback |
|---|---|---|---|---|
| Maps | MapLibre GL + self-hosted Protomaps basemap on R2 | No per-request pricing, no vendor lock, India coverage adequate | ~₹0 | Static list view without map |
| Geocoding | Static India PIN-code centroid table | Zero dependency, sufficient granularity for "nearest kendra" | ₹0 | — |
| Vision/LLM | Provider-agnostic adapter; two providers configured | Model pricing and quality move fast; never hard-code one | ₹0.20–0.90/scan | Manual entry path always available |
| WhatsApp | Meta Cloud API direct (not a BSP) | BSPs add per-message markup for no v0 benefit | ~₹0.13/utility msg | SMS via MSG91 |
| Analytics | Cloudflare Web Analytics + self-hosted PostHog later | No cookies, no consent banner, no PII | ₹0 | — |
| Errors | Sentry free tier | Standard | ₹0 | Structured logs |
| Email (B2B only) | Resend free tier | 3k/month is ample | ₹0 | — |
| Payments | **None in v0** | No consumer transactions by design | — | — |

**Decision: the LLM integration is behind a narrow adapter interface.**

```typescript
interface VisionExtractor {
  extract(image: ArrayBuffer, opts: ExtractOpts): Promise<PrescriptionExtraction>;
  readonly costPerCallPaise: number;
  readonly modelId: string;
}
```

*Why:* the per-scan cost is the dominant variable cost in the system, and the price/quality frontier for vision models is moving monthly. Switching providers must be a config change, and the extraction schema must be provider-independent so a golden eval set can score any model on identical inputs.

---

# PART 8 — INFRASTRUCTURE

## 8.1 The stack

```
┌─────────────────────────────────────────────────────────┐
│ Cloudflare Pages      static site, ~50k pages, unlimited│
│                       bandwidth, commercial use allowed │
├─────────────────────────────────────────────────────────┤
│ Cloudflare Workers    API, ~100k req/day free           │
├─────────────────────────────────────────────────────────┤
│ Cloudflare D1         canonical DB, ~5 GB free          │
├─────────────────────────────────────────────────────────┤
│ Cloudflare KV         hot ladders, feature flags,       │
│                       rate-limit counters, version ptr  │
├─────────────────────────────────────────────────────────┤
│ Cloudflare R2         raw snapshots, map tiles, 10 GB   │
│                       free, zero egress fees            │
├─────────────────────────────────────────────────────────┤
│ Cloudflare Queues     OCR jobs (v1)                     │
├─────────────────────────────────────────────────────────┤
│ GitHub Actions        ingestion cron + CI/CD            │
└─────────────────────────────────────────────────────────┘
```

**Decision: consolidate on one provider for v0 despite the lock-in.**

*Why:* a two-person team's scarcest resource is attention. One dashboard, one CLI (`wrangler`), one billing relationship, one set of IAM concepts. The free tiers compose without surprises, and R2's zero egress removes the single largest unpredictable cloud cost.

*The lock-in, honestly assessed:* D1 is SQLite — portable. R2 is S3-compatible — portable. Workers is the real lock-in, and it is contained to HTTP handlers behind Hono, which runs on Node and Bun unchanged. Realistic migration cost is days, not months. Accept it.

## 8.2 Environments

| Env | Purpose | Data |
|---|---|---|
| `local` | Development | `wrangler dev` + local D1 seeded from a sanitised subset |
| `preview` | Per-PR ephemeral | Cloned staging DB |
| `staging` | Pre-promotion validation | Full data, promoted 24h behind prod |
| `production` | Live | — |

**Staging runs one promotion cycle behind production.** Every snapshot is promoted to staging first, where a smoke suite queries 200 known formulations and asserts the ladder output against golden files. Only on pass does production promote. This catches parser drift before users see it.

## 8.3 CI/CD

```yaml
# Pipeline 1 — serving (on PR / merge to main)
  lint → typecheck → unit → integration (miniflare + local D1)
       → build → Lighthouse budget assert
       → deploy preview → Playwright smoke → deploy prod (on main)

# Pipeline 2 — ingestion (cron, 02:00 IST)
  matrix over sources:
    fetch → [no change ⇒ exit] → parse → validate
          → promote to staging → staging smoke suite
          → promote to production → trigger partial static rebuild
          → post summary to ops channel

# Pipeline 3 — resolver backfill (weekly / manual)
  resolve unresolved products → write match_audit
  → export low-confidence rows to review queue
  → report coverage delta
```

## 8.4 Secrets

Wrangler secrets for the Workers runtime; GitHub encrypted secrets for Actions. Nothing in `.env` files committed anywhere; `gitleaks` in pre-commit. Model API keys are scoped and rotated quarterly. There are no database passwords — D1 access is binding-based, which removes a whole credential class.

## 8.5 Observability

**Structured JSON logs** with a correlation ID per request, propagated through to background jobs.

**Never logged:** prescription image bytes, phone numbers, full IPs (truncate to /24), any extracted medication text.

**Metrics** (Workers Analytics Engine, no additional cost):
- p50/p95/p99 latency by endpoint
- cache hit ratio (target > 90%)
- ladder computation time
- resolver confidence distribution
- OCR escalation rate and cost per scan
- per-source staleness in days

**Alerts:**

| Condition | Severity |
|---|---|
| Any source stale > 45 days | Page |
| Ceiling-price source stale past 15 April | Page — annual revision missed |
| Snapshot quarantined | Page |
| Cache hit ratio < 70% for 1h | Warn |
| OCR cost/day > 2× 7-day average | Warn |
| Error rate > 1% for 15 min | Page |
| Any `ACTIVE_RECALL` verdict served | Log + weekly review |

## 8.6 Backup and disaster recovery

| Asset | Protection | RPO | RTO |
|---|---|---|---|
| Raw snapshots (R2) | Immutable writes, versioning on | 0 | n/a |
| D1 canonical | Time Travel (30d) + nightly SQL dump to R2 | 24h | < 1h |
| Curated artifacts (NTI list, overrides, synonyms) | Git — the source of truth | 0 | minutes |
| Static site | Rebuildable from D1 | 0 | ~20 min |

**The recovery property that matters:** total loss of D1 is recoverable by replaying parsers over the R2 raw store plus the git-versioned curated artifacts. Estimated full rebuild: 2–4 hours. This is why the raw store is immutable and the curated human judgements live in git rather than in the database.

Quarterly restore drill, timed, into a scratch environment.

---

# PART 9 — SECURITY, PRIVACY, COMPLIANCE

## 9.1 Regulatory position

**Salt is not a pharmacy.** It does not stock, sell, dispense or deliver drugs, so the Drugs and Cosmetics Act retail licensing regime does not apply. This position must be actively defended in product decisions: no "buy now" that completes a transaction on Salt, no inventory claims, no order handling.

**Salt is not a medical device / SaMD.** It provides price information, not diagnosis or treatment recommendation. The boundary is the substitution engine: telling a user two products are interchangeable edges toward clinical decision support. Mitigations — an NTI blocklist, `CONSULT_REQUIRED` verdicts, no "switch and save" call to action on any non-exact match, and prominent non-advice framing on every surface — keep it on the information side of the line. This boundary should be reviewed with counsel before v1 ships OCR.

**Advertising.** The Drugs and Magic Remedies (Objectionable Advertisements) Act prohibits advertising drugs for specified conditions. Salt must never generate content implying a drug cures a listed condition. Programmatic SEO pages are the risk surface: templates must describe *price and composition only*, never indications. This is a template-level constraint enforced in code review.

## 9.2 DPDP Act 2023 compliance

Prescription images and medication history are personal data, and arguably sensitive.

| Requirement | Implementation |
|---|---|
| Lawful basis | Explicit consent at the scan step, purpose-specific |
| Notice | Plain-language, pre-upload, in the user's language |
| Purpose limitation | Images used solely for extraction; never for training without separate opt-in |
| Data minimisation | Image deleted within 60s of extraction by default |
| Storage limitation | Opt-in history only; deletion within 30 days of request |
| Erasure right | Self-service deletion endpoint, hard delete, logged |
| Security | TLS 1.3 in transit; AES-256 at rest; signed short-lived upload URLs |
| Breach notification | Documented runbook, Data Protection Board notification path |
| Children's data | No processing for under-18s; no age-gated features |

**Decision: default to processing without persistence.**

*Why:* the safest health data is the health data you never stored. Building history as a strictly opt-in feature means the default user leaves no durable trace, which collapses breach severity and simplifies every compliance conversation. The cost is losing longitudinal data on non-consenting users, which is the correct trade.

## 9.3 Application security

- All input validated with zod at the boundary; unknown parameters rejected, not ignored.
- Parameterised SQL only; the linter forbids string-concatenated queries.
- CSP with no `unsafe-inline`; SRI on any third-party script (there should be none).
- Uploads: MIME sniffing, magic-byte check, 10 MB cap, image-only, stripped EXIF (removes GPS from prescription photos — a real and easily-overlooked leak).
- Dependency scanning via Dependabot; `pnpm audit` gate in CI.
- API keys hashed with Argon2id at rest.

## 9.4 Data governance

- **Correction protocol:** a manufacturer or pharmacy disputing a price gets a public, documented route. Corrections are applied as new versioned rows, never as edits, and the correction history is visible on the product page. This is the single most credibility-preserving mechanism in the system.
- **Clinical artifact ownership:** the NTI list and substitution rules require a named pharmacist reviewer, a review date and a citation. Versioned in git with mandatory review on change.
- **Source licensing register:** every source records its license basis. Tier-2 (commercial ToS) sources are flagged in the UI and separable from the product with a config change.

---

# PART 10 — RELIABILITY

## 10.1 Failure modes

| # | Failure | Detection | Degraded behaviour | Recovery |
|---|---|---|---|---|
| F1 | Government portal down | Fetch timeout, circuit breaker | Serve last promoted snapshot; staleness banner if > 30d | Auto-retry with backoff |
| F2 | Portal HTML/PDF structure changes | Parser exception or drift gate | Quarantine; source frozen at last good | Human fixes parser, replays from R2 |
| F3 | Bad data promoted | Staging smoke suite; user report | Roll back by re-closing rows to previous version | Version pointer rollback; < 5 min |
| F4 | LLM provider outage | Adapter error rate | Scan disabled with a clear message; manual entry always available | Failover to secondary provider |
| F5 | Resolver mismaps a product | Random audit sample; user report | Product shows "composition unverified", excluded from ladder | Correct + retrain + backfill |
| F6 | D1 unavailable | Query errors | Serve stale KV ladders and fully static pages | Cloudflare recovery; restore from dump |
| F7 | Annual WPI ceiling revision missed | Date-based alert after 15 April | Ceiling shown with an explicit "may be outdated" flag | Manual fetch |
| F8 | Kendra data stale, outlet closed | User reports | Outlets marked "last verified {date}" | Monthly refresh; report-driven flagging |
| F9 | Traffic spike | Rate-limit metrics | Edge cache absorbs; static pages unaffected | Auto-scales |

## 10.2 Degraded-mode design

Every consumer of the ladder must handle three states, and the frontend renders all three deliberately:

```typescript
type LadderState =
  | { kind: 'fresh';    ladder: Ladder }
  | { kind: 'stale';    ladder: Ladder; staleDays: number }
  | { kind: 'partial';  ladder: Ladder; missingChannels: string[] }
```

**Design rule: never show an empty state where a partial answer exists.** If the e-pharmacy channel is unavailable, show the Jan Aushadhi and ceiling data and say the third channel is temporarily missing. A user who gets 70% of the answer returns; a user who gets an error page does not.

## 10.3 Idempotency

- Ingestion is idempotent by content hash — re-running a job is always safe.
- Promotion runs inside a transaction and is guarded by an advisory lock.
- `POST /v1/scan` accepts an `Idempotency-Key` header; duplicate keys within 24h return the original job, which prevents double-charging OCR cost on a client retry.

## 10.4 Staleness contract

Published on `/sources` and surfaced in the API:

| Source | Target freshness | Warn | Alert |
|---|---|---|---|
| PMBJP catalogue | ≤ 30 days | 45 | 60 |
| NPPA ceilings | ≤ 30 days | 45 | 60 |
| Annual WPI revision | By 15 April | 20 April | 25 April |
| Kendra directory | ≤ 30 days | 60 | 90 |
| E-pharmacy prices (v1) | ≤ 7 days | 14 | 21 |

---

# PART 11 — ENGINEERING STRUCTURE

## 11.1 Repository layout

Single monorepo, pnpm workspaces + Turborepo.

```
salt/
├── apps/
│   ├── web/                 Astro site
│   ├── api/                 Workers + Hono
│   └── admin/               internal review tool (Astro, auth-gated)
├── packages/
│   ├── schema/              SQL migrations + generated TS types
│   ├── domain/              pure types: Molecule, Formulation, Ladder
│   ├── normalize/           §4.1 composition normaliser
│   ├── resolve/             §4.2 resolver cascade
│   ├── equivalence/         §4.3 safety engine + NTI list
│   ├── pricing/             §4.4 ladder engine
│   ├── geo/                 §4.5 geohash + haversine
│   ├── db/                  repository interfaces + D1 impl
│   └── clients/             vision, whatsapp adapters
├── ingest/                  Python
│   ├── sources/             one module per source (S1..S10)
│   ├── core/                fetch, validate, promote, r2
│   └── tests/golden/        checked-in raw fixtures
├── data/                    git-versioned CURATED JUDGEMENTS
│   ├── nti_molecules.yaml
│   ├── molecule_synonyms.yaml
│   ├── brand_overrides.yaml
│   └── dosage_forms.yaml
└── ops/                     runbooks, alerts, DR drill scripts
```

**Decision: `normalize/` and `equivalence/` are pure, dependency-free TypeScript packages.**

*Why:* they encode the clinical logic, they must be identically callable from the API, from ingestion validation, and from tests, and they must be exhaustively unit-testable without any I/O. Purity is what makes property-based testing possible, and property-based testing is what makes the safety claims credible.

*Consequence:* the Python ingestion pipeline cannot call them directly. Resolved via a small Node CLI invoked from Python for the normalisation step — a deliberate accepted seam, chosen over reimplementing the clinical logic twice, which would guarantee divergence.

## 11.2 Key interfaces

```typescript
// packages/db — nothing outside this package writes SQL.
interface FormulationRepo {
  byId(id: number): Promise<Formulation | null>;
  byCanonicalKey(key: string): Promise<Formulation | null>;
  currentPrices(id: number): Promise<PricedProduct[]>;
  currentCeiling(id: number): Promise<CeilingPrice | null>;
}

// packages/normalize — pure
function normalise(raw: string, hint?: FormHint):
  Result<CanonicalFormulation, NormalisationError>;

// packages/equivalence — pure
function assessEquivalence(src: Formulation, cand: Formulation):
  EquivalenceResult;

// packages/pricing — pure given inputs
function buildLadder(
  src: Formulation,
  candidates: PricedProduct[],
  ceiling: CeilingPrice | null,
  opts: { quantity: number }
): Ladder;

// packages/clients
interface VisionExtractor {
  extract(image: ArrayBuffer, opts: ExtractOpts): Promise<PrescriptionExtraction>;
  readonly costPerCallPaise: number;
  readonly modelId: string;
}
```

Note that `buildLadder` takes its data as arguments rather than fetching. All I/O happens in the Worker handler; the engines are pure. This is what makes the golden-file test strategy work.

---

# PART 12 — DEVELOPMENT PLAN

## 12.1 MVP scope

**In:**
- Scheduled formulations + PMBJP catalogue only (~6,000 formulations)
- Brand and molecule search
- Price ladder with ceiling comparison
- Kendra proximity by pincode
- Overcharge checker
- ~50k programmatic SEO pages
- English only
- No authentication, no accounts

**Deliberately deferred, with reasons:**

| Deferred | Why |
|---|---|
| Prescription OCR | Highest technical risk; the catalogue it depends on must exist first |
| E-pharmacy channel | Introduces ToS exposure with no v0 revenue benefit |
| User accounts | Eliminates the entire DPDP surface for six months |
| Crowdsourced prices | Needs traffic that does not yet exist |
| WhatsApp bot | Needs the ladder to be proven correct first |
| Multi-language | Needs evidence of demand |
| B2B API | Needs a validated buyer before a line of code |
| Postgres migration | Needs scale that does not yet exist |

## 12.2 Twelve-week build order

| Wk | Milestone | Exit criterion |
|---|---|---|
| 0 | **S5 enumerability spike** | Written answer: is Pharma Sahi Daam enumerable? Everything downstream depends on this |
| 1–2 | Ingestion core + S1, S3 | PMBJP catalogue and NPPA ceilings in D1, replayable from R2 |
| 3 | S2, S10 + geo | 14k kendras geocoded, prefix search works |
| 4–5 | Normalisation engine | ≥ 95% accuracy on the 1,000-item golden corpus |
| 6 | Resolver Tiers 1–2 | ≥ 85% of products auto-resolved; audit rows written |
| 7 | Equivalence engine + NTI list | Clinical review sign-off obtained |
| 8 | Ladder engine + API | `/v1/ladder` returns correct output for 200 golden formulations |
| 9–10 | Astro site, static generation | 50k pages built; Lighthouse budgets pass |
| 11 | Observability, staging gate, DR drill | Full restore from R2 completed and timed |
| 12 | Launch | Live, indexed, `/sources` public |

**Parallel to weeks 8–12:** the five payer validation conversations. These gate whether the B2B roadmap is real, and they cost nothing but time.

## 12.3 Testing strategy

| Layer | Approach | Gate |
|---|---|---|
| Parsers | Golden-file: checked-in raw fixtures → expected rows | Byte-exact |
| Normaliser | Property-based (determinism, order invariance, no drops) + 1,000-item labelled corpus | ≥ 95% |
| Resolver | Labelled eval set of 500 product→formulation pairs; precision and recall tracked per tier | Precision ≥ 0.98 |
| Equivalence | Exhaustive table-driven tests over every rule; **every NTI molecule has an explicit test** | 100% branch |
| Ladder | Snapshot tests on 200 formulations across quantities | Exact |
| API | Contract tests against the OpenAPI schema | Pass |
| E2E | Playwright: search → ladder → kendra | Pass |
| Perf | Lighthouse CI budgets | Enforced |

**Precision over recall on the resolver, deliberately.** A product we fail to map shows "composition unverified" and is excluded from the ladder — a missing option. A product we map *wrongly* recommends the wrong drug. The asymmetry is total, and the thresholds should reflect it.

---

# PART 13 — ECONOMICS OF THE ARCHITECTURE

## 13.1 Cost by stage

| Component | v0 (0–50k MAU) | Stage 2 (50k–500k) | Stage 3 (1M+ / B2B) |
|---|---|---|---|
| Hosting + CDN | ₹0 | ₹0 | ~₹2,000/mo |
| Workers | ₹0 | ~₹500/mo | ~₹4,000/mo |
| Database | ₹0 (D1) | ~₹1,700/mo (Neon) | ~₹15,000/mo |
| Object storage | ₹0 | ₹0 | ~₹1,000/mo |
| Ingestion compute | ₹0 (Actions) | ₹0 | ~₹4,000/mo (dedicated) |
| Proxies (if S9 added) | ₹0 | ~₹3,000/mo | ~₹8,000/mo |
| OCR inference | ₹0 (deferred) | ₹10,000–45,000/mo | scales linearly |
| Search | ₹0 (FTS5) | ₹0 | ~₹5,000/mo (Typesense) |
| Monitoring | ₹0 | ₹0 | ~₹4,000/mo |
| Domain | ₹1,000/yr | ₹1,000/yr | ₹1,000/yr |
| **Total** | **~₹1,000 one-time** | **₹15,000–50,000/mo** | **₹45,000–90,000/mo + OCR** |

## 13.2 Acceptable early simplifications

| Simplification | Acceptable because | Replace when |
|---|---|---|
| D1/SQLite | Dataset < 200 MB, read-only serving | Crowdsourced writes arrive, or PostGIS is needed |
| FTS5 search | Corpus is small, queries are simple | > 500k documents or faceted browse needed |
| GitHub Actions cron | Free, ample timeouts | Ingestion exceeds 6h or IPs get blocked |
| No auth | No accounts to protect | Saved history ships |
| Static PIN centroids | Sufficient for "nearest kendra" | Street-level accuracy required |
| Geohash proximity | 14k outlets, small candidate sets | Outlet count × 10, or polygon queries needed |
| Single-writer ingestion | One job, monthly cadence | Real-time sources appear |
| Manual review queue in a spreadsheet | Volume is low | > 500 items/week |

## 13.3 What must never be simplified

The NTI blocklist, the substitution safety gates, the immutable raw store, the append-only price table, and provenance on every displayed number. These are the parts that are expensive to retrofit and catastrophic to get wrong. Everything else can be a shortcut.

---

# PART 14 — SCALING PATH

### Stage 1 — 0 to 50k MAU
Architecture as specified. Nothing changes. The dominant constraint is data coverage and correctness, not infrastructure.

### Stage 2 — 50k to 500k MAU
Triggered by: D1 approaching size limits, OCR volume material, crowdsourced writes beginning.

1. **D1 → Neon Postgres.** Swap the `@salt/db` implementation. Gains PostGIS, `pg_trgm`, materialised views. Add Hyperdrive for connection pooling from Workers.
2. **Cloudflare Queues for OCR** with a dead-letter queue and per-user cost caps.
3. **Read replica** for the analytical workload so B2B queries never contend with consumer reads.
4. **Precompute the top 10k ladders** on promotion rather than lazily.
5. **Typesense** if faceted therapeutic-class browsing becomes a requirement.

### Stage 3 — 1M+ MAU with B2B API
1. **Split the B2B API into its own Worker** with independent rate limits, SLAs and deploy cadence. B2B customers must never be affected by consumer traffic, and vice versa.
2. **Materialise the price index** into a versioned Parquet snapshot on R2, published monthly. This is the actual licensable product — customers query it in their own warehouse, which is a far better fit than hitting a live API.
3. **Move ingestion to a dedicated worker pool** if source count exceeds ~30.
4. **Multi-region D1/Postgres read replicas** if latency outside India matters.
5. **Formal SLOs** with an error budget: 99.9% availability, p95 < 200 ms.

**The premature-infrastructure warning:** none of Stage 2 or 3 should be built before its trigger fires. The architecture is deliberately designed so each step is a contained swap behind an existing interface, which is what buys the right to defer.

---

# PART 15 — UNRESOLVED DECISIONS

These are genuinely open and should not be papered over.

| # | Decision | Options | Decision criterion | Owner | By |
|---|---|---|---|---|---|
| U1 | **Is Pharma Sahi Daam enumerable?** | (a) Bulk enumeration (b) Reverse lookup per formulation (c) Fall back to S9 | Empirical — one afternoon of manual testing | Eng | Week 0 |
| U2 | Add e-pharmacy channel at all? | (a) Never — stay purely government-sourced (b) v1 with clear labelling | Whether payer customers require long-tail brand coverage | Founder | Month 4 |
| U3 | Is the substitution verdict SaMD? | (a) Information only (b) Restructure as pure price display | Legal opinion before v1 OCR | Counsel | Month 3 |
| U4 | Consumer accounts at all? | (a) Never (b) Opt-in for refill reminders | Whether retention is achievable without them | Founder | Month 6 |
| U5 | B2B delivery: live API or Parquet snapshot? | (a) API (b) Snapshot (c) Both | First customer's actual integration preference | Eng + Founder | After first pilot |
| U6 | Who signs off the NTI list? | (a) Contract pharmacist (b) Advisory board | Cost vs credibility | Founder | Month 2 |
| U7 | Kendra stock: partner with BPPI, or crowdsource? | (a) Pursue partnership (b) User-reported (c) Never claim stock | Whether BPPI engages | Founder | Month 9 |
| U8 | Handwriting corpus for OCR eval | (a) Buy/commission labelled set (b) Collect from early users with consent | Cost, and whether (b) is viable pre-scale | Eng | Month 4 |

**U1 is the critical path.** Every downstream estimate in Part 12 assumes the good case. Resolve it before committing to the schedule.

---

## Appendix A — Worked example, end to end

```
User searches "dolo 650"

FTS5 → product(brand_slug='dolo-650', pack_size=15)
     → formulation_id 4412

GET /v1/ladder?formulation=4412&quantity=30&pincode=560034

formulation 4412
  canonical_key = "tablet|IR|317:650:mg:-"
  components    = [paracetamol 650mg]
  is_nti        = false

products on 4412 (current prices):
  P1 Dolo 650      branded    15 tab  ₹31.50   unit ₹2.100
  P2 Calpol 650    branded    15 tab  ₹29.00   unit ₹1.933
  P3 Paracetamol   unbranded  10 tab  ₹11.00   unit ₹1.100
  P4 PMBJP Para650 jan_aush   10 tab  ₹ 2.80   unit ₹0.280

equivalence: all EXACT_MATCH (same key, non-NTI, no recalls)

effectiveCost for quantity 30:
  P4  ceil(30/10)=3 packs × ₹2.80  = ₹ 8.40   (wastage 0)
  P3  ceil(30/10)=3 packs × ₹11.00 = ₹33.00   (wastage 0)
  P2  ceil(30/15)=2 packs × ₹29.00 = ₹58.00   (wastage 0)
  P1  ceil(30/15)=2 packs × ₹31.50 = ₹63.00   (wastage 0)

ceiling: ₹2.09/unit excl GST × 1.12 = ₹2.34/unit legal max
  → P1 at ₹2.10/unit is UNDER the ceiling — no overcharge flag

kendras: geohash7('560034' centroid) prefix(5) → 2 outlets < 3km

RESPONSE
  ladder      [P4, P3, P2, P1]
  topSaving   ₹63.00 − ₹8.40 = ₹54.60  (87%)
  legalMax    ₹2.34/tablet  (S.O.3869(E))
  kendras     2, stockDisclaimer: "catalogue_only"
  asOf        2026-07-28
  provenance  [pmbjp_catalogue, nppa_ceiling, ipdms]
```

## Appendix B — Sources for factual claims

- National Health Accounts Estimates for India 2021-22, MoHFW — OOPE at 39.4% of THE
- Selvaraj, Farooqui & Karan, *BMJ Open* 2018 — medicines ≈ two-thirds of OOP health payments
- Kamath et al., *Frontiers in Public Health* 2025 — 46M households in hardship, 29M from medicines alone
- Gupta et al., *J Population Therapeutics & Clinical Pharmacology* 2025 — NSAID price disparity across PMBJP, NPPA, e-pharmacies (35× mefenamic acid, 23× tramadol, 8–12× uncapped)
- NPPA — 928 scheduled formulations with ceiling prices, ~3,111 new drugs with retail prices; DPCO 2013; IPDMS 2.0 / Pharma Sahi Daam
- PMBJP / BPPI — ~14,200 kendras, ~2,047 products, 50–90% below branded MRP; batch recall history
- NMC Registered Medical Practitioner (Professional Conduct) Regulations 2023 (in abeyance); NMC directive to medical colleges Dec 2025; Punjab & Haryana HC, *Yogesh v. State of Haryana*, 27 Aug 2025
- Mark Cuban Cost Plus Drug Company — cost + 15% markup + ~$5 pharmacy fee + ~$5 shipping
- Company disclosures: Medkart, Zota Healthcare/Davaindia, MedPlus
