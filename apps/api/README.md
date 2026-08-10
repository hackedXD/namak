# @salt/api

Cloudflare Workers + Hono API (design §5). Wires the pure engines to D1 through
the `@salt/db` repository port, so the same code is tested in Node and runs on
Workers unchanged.

## Endpoints (v0)

- `GET /v1/ladder?formulation={id}&quantity={n}&pincode={6}&quoted={rupees}` —
  the price ladder + ceiling + overcharge, with a provenance block. **Live** (needs
  canonical formulation/product data in D1 to return rows; returns
  `resolvable:false` until then).
- `GET /v1/meta/health` — knowledge version + per-source staleness. **Live.**

Pending canonical data / later milestones (see TODO.md): `/v1/search`,
`/v1/product/{slug}`, `/v1/molecule/{slug}`, `/v1/outlets`.

## Design properties enforced here

- **Response envelope** (§5.2): every response carries `meta` (knowledgeVersion,
  asOf, staleness); price responses carry a `provenance[]` block.
- **Error taxonomy** (§5.5): 400 validation (unknown params rejected via zod
  `.strict()`), 404 not found, and — deliberately — **200 with `resolvable:false`**
  for a valid question we can't yet answer, and 200 with `staleness.degraded` for
  stale data. These are normal states, not errors.
- **No personalisation**: the ladder engine is deterministic; a given query is
  byte-identical for every user (edge-cacheable).

## Test / typecheck

```bash
pnpm --filter @salt/api test        # app.request() in vitest — no Workers runtime
pnpm --filter @salt/api typecheck
```

## Deploy

Needs a Cloudflare account (TODO.md). See `wrangler.toml`.
