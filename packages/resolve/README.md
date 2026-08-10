# @salt/resolve

The brand → formulation resolver (design §4.2). Maps a product's raw composition
to a formulation id via a three-tier cascade, cheapest first, with confidence
gating. **Pure TypeScript**, except the LLM tier which is an **injected** port —
so the package itself does no I/O and is fully unit-testable.

```ts
const result = await resolve(
  { rawComposition: 'Metformin HCl 500mg + Glimepiride 2mg SR Tablet' },
  { lexicon, formulations, adjudicator },  // adjudicator optional
);
// → { formulationId, method: 'deterministic'|'fuzzy'|'llm'|'none', confidence,
//     needsHumanReview, evidence }   ← evidence is written to match_audit
```

## The cascade

1. **Tier 1 — deterministic (₹0):** prior exact `manufacturer|brand|pack`; then
   normalise (§4.1) and match the canonical key. Confidence 1.0.
2. **Tier 2 — fuzzy (₹0):** blocking (share ≥1 molecule, same form, same
   component count) → weighted score (molecule Jaccard, strength closeness, form,
   release). Auto-accepts only a **structural** match (see precision gate below).
3. **Tier 3 — LLM adjudication:** the top-5 fuzzy candidates go to the injected
   adjudicator, which may pick **one of them** or decline — never invent. Accept
   only if the choice is in the candidate set AND confidence ≥ 0.90.
4. **Human review** for everything else. `needsHumanReview: true`.

## Precision over recall (target ≥ 0.98) — two deliberate deviations from the design

Both make the resolver *safer* than the literal spec; both are documented in code.

- **Strength similarity is magnitude- and salt-aware, not cosine.** The design says
  "strength vector cosine (log-scaled)", but cosine of a single-molecule strength
  is always 1.0 — it cannot tell 5 mg from 2.5 mg. We use `min/max` strength ratio,
  zeroed when salt form or unit differs. (`score.ts`)
- **Tier-2 auto-accept has an exact-strength gate.** The 0.92 score threshold alone
  passes amlodipine 6 mg vs 5 mg (0.95) when it's the only blocked candidate (no
  runner-up to trip the margin). So auto-accept additionally requires identical
  molecule set and exact strengths/salts; near-matches fall through to the LLM/
  human tier. (`resolve.ts`)

Net effect: the resolver never approximates strength or crosses a salt form. Tested
explicitly (succinate↛tartrate, 6 mg↛5 mg, LLM never invents a choice).

## Tested

`resolve.test.ts` (14) — the four tiers, salt/strength safety, LLM constrained/
low-confidence/decline paths, normalise-failure → review. `score.test.ts` (7) —
Jaccard, strength closeness, blocking, and the scoring flaw the gate defends.

**Not yet (in TODO.md):** the 500-pair labelled eval set that measures precision/
recall per tier; the real LLM adjudicator adapter in `@salt/clients` (no API key
wired — zero cost).
