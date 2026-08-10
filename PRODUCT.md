# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro (SSG) + Cloudflare Workers (Hono) + D1 (SQLite) + R2. TypeScript strict mode, pnpm workspaces + Turborepo. Python ingestion via GitHub Actions cron (02:00 IST). All services in free tiers.

## Users

**Primary:** patients and consumers finding therapeutically equivalent medicines and comparing prices; health workers checking fair pricing and detecting overcharges; researchers studying India's medicine price structure.

**Operating context:** India, Jan Aushadhi outlets, branded pharmacies, e-pharmacies, price ceiling information. Users need to match a branded drug (e.g., Metoprolol Cipla 50mg) to cheaper equivalents and see the statutory NPPA ceiling price as a reference.

## Product Purpose

Salt is a **neutral medicine price index for India**: given a brand/molecule/formulation, return every therapeutically equivalent product ranked by price per unit, across Jan Aushadhi (government) / unbranded / branded channels, alongside the NPPA statutory ceiling price. No stocking, no selling, no dispensing. Neutrality is the business model.

Success: users find the cheapest clinically equivalent option and know if they are being overcharged.

## Positioning

**The one number no competitor shows:** NPPA statutory ceiling price on every formulation. Combined with price ladder (brand/unbranded across channels) and kendra proximity (Jan Aushadhi store locator by pincode).

## Operating Context

- **Data sources**: S1 (PMBJP catalogue, Jan Aushadhi), S3 (NPPA ceiling prices), S2 (kendra locations, blocked API pending India-resident fetch), S10 (PIN centroids for proximity), and 6 other sources (future).
- **Workflows**: search by brand → see ladder + ceiling; search by molecule → see all formulations; enter pincode → find nearest Jan Aushadhi; check if quoted price exceeds ceiling.
- **Canonical formulation key**: includes salt form (metoprolol succinate ≠ tartrate) and release type (SR ≠ IR). Never drop these to simplify matching.
- **Price history**: append-only; a price change is a new row with `valid_from`/`valid_to`, never an in-place UPDATE.
- **Ingestion**: batch-ingest, serve-static. Raw bytes stored in R2 before parsing; parser is pure function; same bytes → same rows.

## Capabilities and Constraints

**MVP scope (launch):**
- Search by brand name or molecule (scheduled formulations + ~6,000 PMBJP formulations)
- Price ladder: brand & molecule search, sorted by price/unit, across Jan Aushadhi/unbranded/branded
- Ceiling comparison: statutory NPPA ceiling price on every formulation
- Kendra proximity: find nearest Jan Aushadhi by pincode (19,238 PIN centroids, GeoNames CC-BY 4.0)
- Overcharge checker: flag if quoted price > ceiling
- ~50,000 SEO pages (static, pre-rendered)
- English only; no auth; no e-pharmacy scraping

**Out of scope for v0 (do not build):**
- Prescription OCR, WhatsApp bot, user accounts, crowdsourced prices
- S1 live data until egress channel (India-resident box vs. Google Drive vs. data.gov.in) is chosen
- Postgres migration (D1/SQLite sufficient for read-heavy static serving)

**Known constraints:**
- CI egress blocks S1/S2 live APIs (janaushadhi.gov.in:8443). S1/S2 fetchers will need India-resident egress or free-tier alternatives (GeoNames, Google Drive, data.gov.in).
- NTI molecules (narcotic, psychotropic) require explicit safety gates and clinical review. Resolver precision target: **0.98** (fail closed; mapping wrongly is worse than not mapping).
- Formulation identity tied to salt + form + release type; supersession and drift gates are per-formulation, deferred to canonical layer (S1 integration pending).

## Brand Commitments

**Name:** Salt. **Tagline:** "the one number no competitor shows" (the statutory ceiling price).

**Voice:** clinical/professional, public-health focused. Authoritative but not dismissive; clear on limitations and data provenance.

**Visual identity:** none yet (delegated to design phase).

## Evidence on Hand

- **Design doc:** `docs/salt-technical-design.md` (specification of record; defers to this file in case of conflict).
- **Operational guide:** this CLAUDE.md (conventions, build stage, decisions log, non-negotiables).
- **Real data sources:** S3 (NPPA ceiling PDFs, reachable), S10 (GeoNames 19,238 PIN centroids, live), S1 probe pending.
- **Code state:** ingestion core + S3 + S10 end-to-end complete; 26 Python tests green (S3), 19 tests green (S10); normalizer + resolver + equivalence engines complete and tested; API (Hono) wired to D1; full Astro frontend prototype on demo data.
- **Absent:** real formulation/product canonical data (blocked on S1 + normaliser→canonical promotion); Cloudflare account (deploy pending); clinical NTI list sign-off.

## Product Principles

1. **Batch-ingest, serve-static.** No live external calls on read path. DB is derived, rebuildable from R2 + git-versioned judgements.
2. **Raw first, immutable forever.** Every fetch byte-identical in R2 before parsing. Parsers are pure functions.
3. **Append-only prices.** Price changes are new versioned rows, never in-place updates.
4. **Fail closed on safety, fail stale on freshness.** If equivalence is uncertain, say so. Serve stale with visible marker rather than erroring.
5. **Provenance on every number.** Source + snapshot date on every API response.

## Accessibility & Inclusion

No product-specific requirement established yet. Standard WCAG 2.1 AA expected for public health tool; confirm in design phase.
