# CLAUDE.md — Salt build guide

Salt is a **neutral medicine price index for India**: given a brand/molecule, it
returns every therapeutically-equivalent product ranked by price per unit, across
Jan Aushadhi / unbranded / branded / (later) e-pharmacy channels, alongside the
NPPA statutory ceiling price. Salt never stocks, sells, or dispenses. Neutrality
is the entire moat.

**The specification of record is `docs/salt-technical-design.md`.** This file is
the operational companion: conventions, non-negotiables, and current build stage,
so context survives across sessions. When the two disagree, the design wins —
and flag the disagreement.

> **Working relationship:** the owner is a solo, non-professional-engineer
> founder who reads code and reasons about architecture. Explain non-obvious
> decisions. Build **incrementally** and **check in at milestone boundaries** —
> do not generate a full ten-source scaffold in one pass. Prefer boring,
> readable code over clever code.

---

## Current build stage

**Milestone 1–2 — Ingestion core + first source (Part 12.2).** Founder approved
proceeding here (2026-08-10) after the U1 spike; U1 itself is being closed out of
band by the founder running the probe from an Indian IP.

### Reachability reality (measured 2026-08-10, from CI datacenter IP) — IMPORTANT

The egress vantage point materially reorders the source plan:

| Source | Host / channel | From CI | Notes |
|---|---|---|---|
| **S3 NPPA ceilings** | `nppa.gov.in` :443 | ✅ reachable | Server-rendered; real ceiling-price + compendium PDFs downloadable. **Verified a real PDF fetch.** |
| S10 PIN centroids | `data.gov.in` :443 | ✅ reachable | |
| S8 CDSCO, MoHFW, eGazette | `*.gov.in` :443 | ✅ reachable | |
| **S1 PMBJP catalogue** | `janaushadhi.gov.in` **:8443** API | ❌ **blocked** | Site is a React SPA on :443 (reachable, no data); the JSON data API is on **:8443**, which **resets the TLS handshake from our IP** — same block class as S5. |
| **S5 Pharma Sahi Daam** | `nppaipdms.gov.in` | ❌ blocked | The original U1 finding. |

**Consequence:** the CI-egress block is **not S5-only** — it also hits S1's live
data API and S2's kendra API (both on janaushadhi `:8443`). Any fetcher for those
portals needs an **India-resident egress** (design §5.4: relocatable fetcher →
Oracle Cloud Always Free India region, or a small always-on box; parse/validate/
promote still run in CI over R2). Reachable *alternatives* to probe for S1 before
committing to an India box: a Google-Drive folder the SPA references (144 PDFs,
Drive is reachable) and `data.gov.in` datasets.

### Decision (self-resolved, non-Part-15): build **S3 first**, not S1

Design Milestone 1–2 lists "S1, S3"; the build rule is one source end-to-end
first. **S3 is chosen as that first source** because (a) it is reachable from CI
with real data today, and (b) the statutory ceiling is the product's core
differentiator ("the one number no competitor shows", §6.3). S1 follows once its
egress channel is settled. Recorded in the Decisions log below.

### Milestone 1–2 state

- ✅ Monorepo skeleton (pnpm + Turborepo, TS strict).
- ✅ `packages/schema` — §2.2 DDL (`0001_init.sql`) + staging (`0002_staging.sql`),
  offline-validated (16 tables, FK check clean).
- ✅ `ingest/core` — Source protocol, immutable content-addressed raw store,
  `fetch_with_dedup` (conditional GET + hash dedup), generic validation gates,
  append-only promoter, snapshot bookkeeping, idempotent migrations, HttpxClient.
- ✅ **S3 (NPPA ceilings) end to end**: fetch → R2 → parse (golden PDF) → validate
  → promote → query. **26 tests green** (golden-file parser test runs with the
  network disabled). Real entrypoint: `python -m ingest.run_nppa_ceiling`.
- Parser: NPPA Compendium-2022 → 1043 ceiling rows (928 unique lines ≈ the
  design's 928 scheduled formulations). Conservative line parser; skips-and-counts
  anything it can't cleanly match (precision over recall).

**Not yet (correctly deferred, not faked):**
- S3 lands in `staging_ceiling`; canonical `ceiling_price` needs `formulation_id`
  from the normaliser (Milestone 4–5).
- Per-formulation supersession + the `price_drift` gate are canonical-layer (need
  stable identity); staging uses snapshot-scoped supersession.
- Currency: Compendium is 2022 (latest CI-reachable consolidated list); newer WPI
  notifications are a pre-launch follow-up.

### Milestone 3 — S2 kendras + S10 PIN centroids + geo (in progress)

- ✅ `packages/geo` — pure TS geohash (encode + neighbours) + haversine + query
  helpers (§4.5). 12 tests (golden + fast-check property); typecheck clean.
  Standard base32 geohash, validated against canonical vectors.
- ✅ **S10 PIN centroids (GeoNames) end to end, live**: fetch → R2 → parse →
  validate → promote → query. 19,238 pincode centroids in D1, 100% coord coverage.
  Canonical `pin_centroid` table with proper per-pincode append-only supersession
  (pincode is a stable identity). `python -m ingest.run_geonames_pincode` verified
  live. Source = GeoNames **CC-BY 4.0** (tier-2 in the licensing register; founder
  chose community CC over the coordinate-empty official India Post data).
- ⏳ **S2 kendra directory — founder running the probe.** Not a reachable official
  CSV (`data.gov.in` has only state-wise counts); the ~16k per-kendra list is
  behind the blocked `janaushadhi:8443` API. Spike prepared for the founder to run
  from an Indian IP: `spikes/s2-kendra/probe.py`. S2 ingestion (fetch → R2 → parse
  → geohash7 → validate → promote → proximity) will be wired once real data is in
  hand. Watch for: AES-encrypted responses + Cloudflare Turnstile (both in the
  site bundle).

**Toolchain note:** pnpm workspace now installed (turbo, typescript, vitest,
fast-check). `pnpm --filter @salt/geo test`. Python: `pytest` (see ingest/README).

### Milestone tracker (Part 12.2)

| Wk | Milestone | Exit criterion | State |
|---|---|---|---|
| 0 | S5 enumerability spike | Written answer on Pharma Sahi Daam | ⏳ blocked (needs India-IP run) |
| 1–2 | Ingestion core + S1, S3 | PMBJP + NPPA ceilings in D1, replayable from R2 | ✅ core + S3 done; S1 deferred (blocked API) |
| 3 | S2, S10 + geo | 14k kendras geocoded, prefix search works | 🟡 geo + S10 done; S2 pending founder probe |
| 4–5 | Normalisation engine | ≥95% on 1,000-item golden corpus | 🟡 engine + property tests done; corpus pending |
| 6 | Resolver Tiers 1–2 | ≥85% auto-resolved; audit rows written | not started |
| 7 | Equivalence engine + NTI list | Clinical review sign-off | not started |
| 8 | Ladder engine + API | `/v1/ladder` correct on 200 golden formulations | not started |
| 9–10 | Astro site, static gen | 50k pages; Lighthouse budgets pass | not started |
| 11 | Observability, staging gate, DR drill | Timed full restore from R2 | not started |
| 12 | Launch | Live, indexed, `/sources` public | not started |

**Packages so far:** `@salt/schema` (SQL), `@salt/domain` (types), `@salt/geo`
(geohash+haversine), `@salt/normalize` (§4.1). `ingest/` (Python): core + S3 +
S10. Tests: 35 Python + 35 TS (geo 12, normalize 23) green.

**Build ONE source end to end (fetch → R2 → parse → validate → promote → query)
before adding a second. Do not scaffold all ten sources upfront.**

---

## Non-negotiables (never simplify these)

From the founder's brief and design Part 13.3. These are catastrophic to get
wrong and expensive to retrofit.

1. **Raw-first ingestion.** Every fetch is stored byte-identical in R2 *before*
   parsing. Parsers read from R2, **never** the network, and are pure functions of
   bytes (same bytes ⇒ same rows). Enforced in tests with network disabled.
2. **Append-only prices.** A price change is a new row with `valid_from`/
   `valid_to`. **Never `UPDATE` a price in place.** Same for ceiling prices and
   corrections (corrections are new versioned rows, §9.4).
3. **Salt form and release type are part of the canonical formulation key (§4.1).**
   Metoprolol succinate ≠ tartrate. SR ≠ IR. Never drop these to "simplify" matching.
4. **NTI blocklist + equivalence gates (§4.3) are safety-critical.** Every NTI
   molecule needs an explicit test. **Resolver precision target 0.98** —
   *failing to map a product is acceptable; mapping it wrongly is not.* Precision
   over recall, deliberately.
5. **Provenance on every price-bearing API response** (source + snapshot date).
6. **`packages/normalize` and `packages/equivalence` are pure TypeScript, zero I/O.**
   Also: `packages/pricing` is pure given inputs (data passed in, no fetching).

Plus the invariants behind them: immutable raw store, the DB is a *derived*
artifact rebuildable from R2 + git-versioned curated judgements, and
`raw_composition` is stored verbatim and never normalised in place.

### Data integrity — hard rule

**Never invent, estimate, or placeholder drug data** — no fabricated prices,
compositions, molecule names, salt forms, or kendra locations, **not even in
fixtures or seed data.** If real data isn't available yet, leave the code path
unimplemented and say so. **Test fixtures must be real bytes fetched from real
sources and checked in** (golden-file). This is why the NTI list, synonyms, and
brand overrides live in `data/` under git with named clinical review, not in code.

---

## Scope discipline (MVP = design Part 12.1 only)

**In:** scheduled formulations + PMBJP catalogue (~6,000 formulations), brand &
molecule search, price ladder + ceiling comparison, kendra proximity by pincode,
overcharge checker, ~50k SEO pages, English only, no auth.

**Do NOT build** (ask first if you think one is needed): prescription OCR,
e-pharmacy scraping, user accounts, WhatsApp, crowdsourced prices, the B2B API,
i18n *content* (i18n *architecture* from day one is fine per §6.6), Postgres
migration.

---

## Stack (design Part 8) — everything must fit free tiers

- **Serving:** Cloudflare Pages (Astro SSG + islands) + Workers (Hono) + D1
  (SQLite) + KV + R2. TypeScript **strict mode**.
- **Ingestion:** Python, run on **GitHub Actions cron** (02:00 IST). PDF parsing
  with `pdfplumber`/`camelot`.
- **Monorepo:** pnpm workspaces + Turborepo.
- **The polyglot seam:** Python ingestion cannot call the pure TS clinical
  packages directly. Normalisation is invoked via a small Node CLI shelled out
  from Python — one implementation of the clinical logic, never two (§11.1).
- **Flag any choice that would incur cost immediately.** No paid tiers in v0.

### Repo layout (target, design §11.1) — build into this incrementally

```
apps/       web (Astro) · api (Workers+Hono) · admin (later)
packages/   schema · domain · normalize · resolve · equivalence · pricing · geo · db · clients
ingest/     Python: sources/ (S1..S10) · core/ (fetch,validate,promote,r2) · tests/golden/
data/       git-versioned CURATED JUDGEMENTS: nti_molecules.yaml, molecule_synonyms.yaml,
            brand_overrides.yaml, dosage_forms.yaml
ops/        runbooks, alerts, DR drill scripts
docs/       salt-technical-design.md (the spec)
spikes/     THROWAWAY diagnostics (e.g. u1-ipdms). Never imported by product code.
```

---

## Testing (write tests alongside each module, not at the end)

| Layer | Approach | Gate |
|---|---|---|
| Parsers | Golden-file: checked-in real raw bytes → expected rows | byte-exact |
| Normaliser | Property-based (determinism, order invariance, no silent drops) + 1,000 labelled | ≥95% |
| Resolver | 500 labelled product→formulation pairs; precision/recall per tier | precision ≥0.98 |
| Equivalence | Exhaustive table-driven over every rule; **every NTI molecule tested** | 100% branch |
| Ladder | Snapshot tests, 200 formulations × quantities | exact |
| Perf | Lighthouse CI budgets (JS <30KB, LCP<2.5s/3G, page<150KB) | enforced |

**Run typecheck + tests before telling the founder something works.**

---

## Handling ambiguity

- **Design Part 15 lists 8 genuinely open decisions (U1–U8). If you hit one, STOP
  and ask** — do not pick. (U1 is live right now.)
- For ambiguities **not** in that list: resolve using the design's stated
  principles (§1.1), implement, and **record the decision in the "Decisions log"
  below** for founder review.

### Architectural principles (§1.1), for resolving ambiguity

1. Batch-ingest, serve-static — no live external calls on the read path.
2. Raw first, immutable forever — DB is a derived artifact.
3. Append-only price facts.
4. Fail closed on safety, fail stale on freshness (serve stale with a visible
   marker rather than erroring; if equivalence is uncertain, say so).
5. Provenance on every number.

---

## Git & workflow conventions

- **Dev branch:** `claude/salt-medicine-price-index-x6cjxu`. Develop, commit, and
  push here. Do not push elsewhere without explicit permission.
- **Small, focused commits** with clear messages. Commit at milestone boundaries
  and for meaningful units of work.
- Push with `git push -u origin claude/salt-medicine-price-index-x6cjxu`.
- **Do not open a PR unless the founder asks.**
- If something in the design "doesn't survive contact with reality," say so
  directly rather than working around it silently (see the U1 finding for the
  first instance).

---

## Decisions log (self-resolved, non-Part-15 ambiguities — for founder review)

- **2026-08-10 — Build S3 (NPPA ceilings) as the first end-to-end source, ahead of
  S1.** Rationale: S1's live data API (`janaushadhi.gov.in:8443`) is IP-blocked
  from CI/datacenter egress (measured), whereas S3 (`nppa.gov.in`) is reachable
  with real data; and the statutory ceiling is the product's core differentiator.
  Resolved via principle §1.1 (build on what's real/reachable) — not a Part-15
  item. Reversible: S1 slots in once its egress channel (India box vs Google
  Drive vs data.gov.in) is chosen.
- **2026-08-10 — S1/S2 live fetchers will likely need an India-resident egress.**
  Founder chose: probe free reachable channels first (Google-Drive folder /
  `data.gov.in`) before any always-on India box. Applies when S1/S2 come up.
- **2026-08-10 — S3 lands in a `staging_ceiling` table, not canonical
  `ceiling_price`.** Canonical rows need `formulation_id` (normaliser, Milestone
  4–5). Staging is fully replayable from R2. Resolves the sequencing gap without
  fabricating formulation IDs.
- **2026-08-10 — Staging supersession is snapshot-scoped; `price_drift` gate
  deferred to the canonical layer.** Parsed S3 rows have no stable per-formulation
  identity (continuation rows recur verbatim: 1043 rows, 928 unique lines), so
  row-keyed supersession/drift is unsound at staging. The unchanged-data no-op is
  handled upstream by content-hash dedup (§3.3.1). Revisit when ceilings carry a
  formulation_id.
- **2026-08-10 — `HttpxClient` verifies TLS via the CA bundle with
  `trust_env=False`** (direct/transparent egress). In this sandbox the explicit
  HTTPS_PROXY CONNECT path presents a cert that doesn't chain to the bundle, while
  the direct path verifies cleanly (proven: data.gov.in 200). Note also nppa.gov.in
  serves an incomplete chain and 503s CI egress IPs — production fetches from India.
