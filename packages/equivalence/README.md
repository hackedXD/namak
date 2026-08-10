# @salt/equivalence

The equivalence & substitution safety engine (design §4.3). Given a source
formulation and a candidate, it returns a verdict a pharmacist would defend:

```ts
assessEquivalence(src, cand, { candidateHasActiveRecall })
// → { verdict: 'INTERCHANGEABLE' | 'CONSULT_REQUIRED' | 'NOT_INTERCHANGEABLE',
//     reasonCode, displayMessage, ruleIds }
```

**Pure TypeScript.** Recall status (external `recall` data) is injected via
context so the engine stays pure and exhaustively testable.

## The seven gates (first firing gate wins — the order is clinical priority)

1. molecule set must match exactly → else `NOT_INTERCHANGEABLE`
2. strengths must match exactly → else `NOT_INTERCHANGEABLE`
3. **NTI drug → `CONSULT_REQUIRED`** (price shown, switch never endorsed)
4. release profile must match (SR ≠ IR) → else `NOT_INTERCHANGEABLE`
5. salt form differs → `CONSULT_REQUIRED`
6. route mismatch → `NOT_INTERCHANGEABLE`; dosage-form differs (not both oral-solid) → `CONSULT_REQUIRED`
7. active recall on candidate → `NOT_INTERCHANGEABLE`
   otherwise → `INTERCHANGEABLE` / `EXACT_MATCH`

`allowsSwitchCta()` returns true only for `INTERCHANGEABLE` — so NTI and every
non-exact case get no "switch and save" nudge (§4.3).

## Safety wiring

- **NTI list** lives in `data/nti_molecules.yaml` (git-versioned curated artifact).
  It sets `is_nti` on molecules; the engine reads that flag. **`nti.test.ts` reads
  the list and asserts EVERY molecule in it → `CONSULT_REQUIRED`** (§12.3), so
  adding a molecule there automatically adds a test.
  ⚠️ The list is `reviewed_by: PENDING` — **not production-usable until a named
  pharmacist signs it** (Part 15 U6; tracked in TODO.md). A test guards that.
- **Kill switch** (`substitution_engine_enabled`, §4.3): a serving-layer KV flag
  degrades to pure price display with no equivalence claims, flippable in <60s
  without a deploy. This pure engine makes no claims unless called; the caller
  checks the flag.

## Tested (45)

`assess.test.ts` (15) — every gate + gate ordering (molecule/strength before NTI;
NTI before salt/release/form) + `allowsSwitchCta`. `nti.test.ts` (30) — the whole
curated NTI list, each → CONSULT, plus the required minimum set is present.

Run: `pnpm --filter @salt/equivalence test`
