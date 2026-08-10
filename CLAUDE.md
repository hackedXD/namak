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

**Milestone 0 — U1 enumerability spike (Part 12.2, week 0).**

- **Status: BLOCKED on reachability, awaiting founder input.** The Pharma Sahi
  Daam portal `nppaipdms.gov.in` (source S5) refuses connections from this cloud
  environment's datacenter IP — TLS handshake reset, confirmed with both curl and
  a real Chromium. The four U1 questions (JSON endpoint? enumeration mode?
  captcha/rate-limit? pagination cursors?) **cannot be answered from CI** and need
  a probe from an Indian IP. Full write-up: `spikes/u1-ipdms/FINDINGS.md`.
- Good news: S5 is the *only* blocked source among the ones checked. **S1 (PMBJP
  catalogue), S3 (NPPA ceilings), S10 (PIN centroids) — the Milestone 1–3 inputs —
  are all reachable.** So ingestion-core work is not gated on U1.
- **Do not start production code until the founder has seen the U1 findings and
  decided** how to source S5 (India-resident fetcher vs reverse-lookup fallback
  §3.2 vs defer). U1 is one of the eight open decisions in Part 15 → stop and ask,
  don't pick.

Next milestone once unblocked: **1–2, Ingestion core + S1 + S3** (PMBJP catalogue
and NPPA ceilings in D1, replayable from R2).

### Milestone tracker (Part 12.2)

| Wk | Milestone | Exit criterion | State |
|---|---|---|---|
| 0 | S5 enumerability spike | Written answer on Pharma Sahi Daam | ⏳ blocked (see above) |
| 1–2 | Ingestion core + S1, S3 | PMBJP + NPPA ceilings in D1, replayable from R2 | not started |
| 3 | S2, S10 + geo | 14k kendras geocoded, prefix search works | not started |
| 4–5 | Normalisation engine | ≥95% on 1,000-item golden corpus | not started |
| 6 | Resolver Tiers 1–2 | ≥85% auto-resolved; audit rows written | not started |
| 7 | Equivalence engine + NTI list | Clinical review sign-off | not started |
| 8 | Ladder engine + API | `/v1/ladder` correct on 200 golden formulations | not started |
| 9–10 | Astro site, static gen | 50k pages; Lighthouse budgets pass | not started |
| 11 | Observability, staging gate, DR drill | Timed full restore from R2 | not started |
| 12 | Launch | Live, indexed, `/sources` public | not started |

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

_None yet._ (U1 is a Part-15 decision and is being escalated, not logged here.)
