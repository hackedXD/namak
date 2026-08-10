# @salt/normalize

The composition normalisation engine (design §4.1). **Pure TypeScript, zero I/O.**
Turns a raw composition string into a canonical formulation + join key, or a
typed failure.

```ts
import { normalise, buildLexicon } from '@salt/normalize';

const lex = buildLexicon({ molecules, saltForms, dosageForms, releaseModifiers });
const r = normalise('Metformin HCl 500mg + Glimepiride 2mg SR Tablet', lex, { dosageFormHint: 'tablet' });
// r.ok === true; r.value.canonicalKey === 'tablet|SR|2:500:mg:hydrochloride;3:2:mg:-'
```

## Why it's pure (and how the data gets in)

The engine is dependency-free and does no I/O so it can be property-tested
exhaustively and called identically from the API, from ingestion (via a Node CLI,
§11.1), and from tests. The curated knowledge it needs — molecule synonyms, salt
forms, dosage forms, release modifiers — is **injected** as a `Lexicon`. In
production the caller builds the lexicon from the git-versioned `data/*.yaml`
artifacts (with named clinical review) plus the `molecule` table.

## Safety rules it enforces (never simplify away)

- **Salt form is preserved and keyed** — `metoprolol succinate` ≠ `tartrate`.
- **Release type is keyed** — `SR` ≠ `IR`.
- **No partial normalisation** — if any component fails to resolve, the whole
  input fails. Failing to map is acceptable; mapping wrongly is not (§12.3).

## Tested

- Table-driven over real compositions (FDCs, salts, synonyms, unit conversion).
- Safety: succinate≠tartrate, SR≠IR, strength distinctions never collapse.
- Property-based (fast-check): determinism, component-order invariance, no
  silent component drops (§4.1 testing).

**Not yet:** the 1,000-item labelled golden corpus (≥95% gate) — that needs a
real volume-sampled labelled set; tracked in TODO.md. The curated `data/*.yaml`
lexicon (with clinical review) is also a follow-up.

Run: `pnpm --filter @salt/normalize test`
