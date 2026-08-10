# @salt/schema

The canonical SQL schema for Salt's knowledge plane (Cloudflare D1 / SQLite).
**This package is the source of record for the database contract** (design §2.2).
The DB is a *derived* artifact — rebuildable from the R2 raw store plus the
git-versioned curated judgements in `data/`.

## Layout

- `migrations/NNNN_name.sql` — forward-only, numbered migrations. Applied in
  filename order.
- `scripts/validate.mjs` — offline smoke test: loads every migration into an
  in-memory SQLite and asserts the expected tables exist with a clean FK check.

## Invariants baked into the schema (do not "simplify" away)

- **Append-only prices.** `product_price` and `ceiling_price` carry
  `valid_from`/`valid_to`; a change is a new row, never an `UPDATE`.
- **Salt form + release type are first-class.** `formulation_component.salt_form`
  and `formulation.release_type` are part of the canonical key (§4.1) — never drop
  them to make matching easier.
- **Provenance everywhere.** Every price/ceiling row carries a `snapshot_id`
  tracing back to an immutable R2 artifact.
- `product.raw_composition` is stored verbatim and never normalised in place.

## Run

```bash
pnpm --filter @salt/schema test
```

TypeScript types generated from this schema will live here too (for the serving
side's compile-checked DB boundary, §1.3) — added when `@salt/db` lands.
