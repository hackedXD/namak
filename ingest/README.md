# ingest — Salt ingestion plane (Python)

Fetch → **R2 (immutable, content-addressed)** → parse (pure, from R2) → validate
→ promote (append-only) → query. Runs on GitHub Actions cron in production
(§5.4); parsing/validation/promotion are location-independent because everything
flows through the raw store.

## Layout

```
core/      source-agnostic pipeline
  models.py     dataclasses (RawArtifact, StagedRow, Snapshot, ValidationReport…)
  rawstore.py   RawStore interface + LocalRawStore (immutable, content-addressed)
  db.py         SQLite (local) / D1 (prod) bookkeeping; applies packages/schema migrations
  fetch.py      fetch_with_dedup — conditional GET + content-hash dedup (§3.3.1)
  http.py       HttpxClient — the only code that does network I/O
  validate.py   generic validation gates (§3.3.2)
  promote.py    append-only promoter (§3.3.3)
  source.py     the Source protocol (fetch / parse / validate)
sources/
  nppa_ceiling.py   S3 — NPPA ceiling prices (first source, end to end)
tests/
  golden/nppa_ceiling/compendium-prices-2022.pdf   REAL bytes from nppa.gov.in
  test_*.py                                         parser golden test + core unit tests
run_nppa_ceiling.py   real-network entrypoint for S3
```

## Setup & run

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r ingest/requirements.txt

# tests (offline — network is disabled in conftest to prove parser purity)
pytest

# live S3 run (writes to ingest/.local/, which is gitignored)
python -m ingest.run_nppa_ceiling
```

## Non-negotiables enforced here

- **Raw first.** Bytes hit the immutable store before any parse. `LocalRawStore`
  refuses to overwrite a key with different bytes.
- **Pure parsers.** `parse()` takes bytes and returns rows — no network, no DB.
  The test suite disables sockets to enforce it.
- **Append-only.** The promoter never `UPDATE`s a value; a change is a new row and
  the old one is closed with `valid_to`.
- **No invented data.** The golden fixture is real NPPA bytes; gate-failure tests
  are transformations of real rows, never fabricated drugs.

## Known limitations (this milestone)

- **S3 lands in `staging_ceiling`, not canonical `ceiling_price`.** Canonical
  promotion needs a `formulation_id` from the normaliser (§4.1, Milestone 4-5),
  which does not exist yet. Staging is fully replayable from R2.
- **Supersession is snapshot-scoped, and `price_drift` is deferred to the
  canonical layer** — both need a stable per-formulation identity that parsed
  source rows don't have (continuation rows recur verbatim; 1043 rows / 928 unique
  lines). See `core/promote.py` and `core/validate.py`.
- **Currency:** the Compendium is NPPA's 2022 consolidated list — the latest
  CI-reachable consolidated artifact. Ingesting newer WPI/notification updates is
  a follow-up before launch (the staleness contract §10.4 surfaces this).
- **Egress:** some gov.in hosts (nppa, cdsco) return 503 to datacenter/CI IPs
  (see `spikes/u1-ipdms/FINDINGS.md`). Production fetches from an India-resident
  egress; the fetcher is relocatable by design.
