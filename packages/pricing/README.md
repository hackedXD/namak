# @salt/pricing

The price ladder engine (design §4.4). **Pure given inputs** — it does no
fetching, so a given `(formulation, candidates, ceiling, quantity, pincode)`
produces a byte-identical ladder for every user (the neutrality claim, §4.4).

```ts
const ladder = buildLadder({
  formulation, candidates, ceiling, quantityNeeded, quotedUnitPrice, channelTier, kendras,
});
// → { ladder[], notInterchangeable[], legalMaxPerUnit, ceilingCitation,
//     topSaving, overcharge, kendras, provenance[] }
```

## What it does (and the decisions behind it)

- **Ranks by `effectiveCost`, not unit price.** `effectiveCost = ceil(quantity /
  packSize) × mrp` — a cheaper per-tablet price in a 100-pack is worse when you
  need 10. Ranking by unit price is arithmetically right and practically wrong.
- **No personalisation, ever.** Deterministic ordering with a stable final
  tie-break (product id). Same input → identical output. This is what makes edge
  caching trivial and the neutrality claim verifiable.
- **Blocked candidates are separated, never hidden.** `NOT_INTERCHANGEABLE`
  products (wrong strength, active recall, …) go in `notInterchangeable`, not the
  main ladder. NTI drugs stay in the ladder as `CONSULT_REQUIRED`.
- **Ceiling comparison + overcharge.** `legalMaxPerUnit = ceilingPerUnit ×
  (1 + GST)`. `overcharge` compares what the user was quoted (per unit) to that
  legal maximum and reports the per-unit and total excess.
- **Provenance on every number** — each row carries its `{ sourceId, snapshotDate }`,
  and the ladder exposes a deduped `provenance[]` for the API's provenance block.

Equivalence is delegated to `@salt/equivalence` (the seven safety gates); kendra
proximity comes from `@salt/geo` at the caller and is passed in as `kendras`.

## Tested (17)

`ladder.test.ts` (14) reproduces the design's **Appendix A worked example**
end to end (ranking, effectiveCost, legal max 2.34, top saving 54.60), plus the
key decisions: cost-not-unit-price ranking, blocked/NTI/recall separation,
determinism, stable tie-break, overcharge. `overcharge.test.ts` (3) the ceiling
maths. (Prices in tests are the spec's illustrative figures, exercising the
arithmetic — not asserted market data.)

Run: `pnpm --filter @salt/pricing test`
