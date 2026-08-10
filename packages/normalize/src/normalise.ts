// Composition normalisation engine (design §4.1). Pure, deterministic, zero I/O.
//
// Turns a raw composition string like
//   "Metformin HCl 500mg + Glimepiride 2mg SR Tablet"
// into a canonical formulation + join key, or a typed failure.
//
// SAFETY RULES baked in (never "simplify" these away):
//  - Salt form is preserved and is part of the key (succinate ≠ tartrate).
//  - Release type is part of the key (SR ≠ IR).
//  - Partial normalisation is FORBIDDEN: if ANY component fails to resolve, the
//    whole thing fails (a half-resolved FDC is a safety hazard). Failing to map a
//    product is acceptable; mapping it wrongly is not (precision over recall).

import {
  type CanonicalComponent,
  type CanonicalFormulation,
  type MoleculeRef,
  type ReleaseType,
  type Result,
  type StrengthUnit,
  ok,
  err,
} from '@salt/domain';
import type { Lexicon } from './lexicon.js';
import { bestMatch } from './trigram.js';

export type NormalisationErrorCode =
  | 'EMPTY_INPUT'
  | 'NO_COMPONENTS'
  | 'UNKNOWN_DOSAGE_FORM'
  | 'NO_STRENGTH'
  | 'UNRESOLVED_MOLECULE';

export interface NormalisationError {
  code: NormalisationErrorCode;
  message: string;
  component?: string;
}

export interface NormaliseOptions {
  dosageFormHint?: string;
  /** trigram acceptance threshold for fuzzy molecule match (§4.1 3d). */
  trigramThreshold?: number;
}

const DEFAULT_THRESHOLD = 0.85;

// number → base unit. Longest tokens first so 'mg/5ml' beats 'mg/ml' beats 'mg'.
const STRENGTH_RE = /(\d+(?:\.\d+)?)\s*(mg\/5ml|mg\/ml|mcg|µg|mg|g|iu|%)/gi;

function toBase(value: number, unit: string): { base: number; unit: StrengthUnit } {
  switch (unit.toLowerCase()) {
    case 'mg/5ml':
      return { base: value / 5, unit: 'mg_per_ml' };
    case 'mg/ml':
      return { base: value, unit: 'mg_per_ml' };
    case 'mcg':
    case 'µg':
      return { base: value / 1000, unit: 'mg' };
    case 'g':
      return { base: value * 1000, unit: 'mg' };
    case 'mg':
      return { base: value, unit: 'mg' };
    case 'iu':
      return { base: value, unit: 'iu' };
    case '%':
      return { base: value, unit: 'pct' };
    default:
      return { base: value, unit: 'mg' };
  }
}

/** Stable numeric formatting so the key never carries float noise. */
function fmt(n: number): string {
  return parseFloat(n.toFixed(6)).toString();
}

function stripPunctuation(s: string): string {
  // keep letters, digits, spaces, and the meaningful chars + / . % & ,
  return s.replace(/[^a-z0-9+/.%&,\s]/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** Split into components on '+', '&', ' and ', and commas NOT flanked by digits
 *  (§4.1 step 2 — commas also appear inside numbers). */
function splitComponents(s: string): string[] {
  return s
    .split(/\s+and\s+|[+&]|(?<!\d),(?!\d)/gi)
    .map((c) => c.trim())
    .filter(Boolean);
}

function detectRelease(tokens: string[], lex: Lexicon): ReleaseType {
  for (const t of tokens) {
    const r = lex.releaseModifiers.get(t);
    if (r) return r;
  }
  return 'IR';
}

function detectDosageForm(
  tokens: string[],
  lex: Lexicon,
  hint: string | undefined,
): { form: string; route: string } | null {
  for (const t of tokens) {
    const f = lex.dosageForms.get(t);
    if (f) return f;
  }
  if (hint) {
    const f = lex.dosageForms.get(hint.toLowerCase());
    if (f) return f;
  }
  return null;
}

interface ParsedComponent {
  molecule: MoleculeRef;
  strengthBase: number;
  strengthUnit: StrengthUnit;
  saltForm: string | null;
}

function parseComponent(
  raw: string,
  lex: Lexicon,
  threshold: number,
): Result<ParsedComponent, NormalisationError> {
  // 3a. strength — take the LAST match (leading numbers are often brand names)
  const matches = [...raw.matchAll(STRENGTH_RE)];
  if (matches.length === 0) {
    return err({ code: 'NO_STRENGTH', message: `no strength in "${raw}"`, component: raw });
  }
  const last = matches[matches.length - 1]!;
  const { base, unit } = toBase(parseFloat(last[1]!), last[2]!);

  // remove ALL strength tokens so stray digits don't pollute the molecule name
  const residual = raw.replace(STRENGTH_RE, ' ');

  // 3c. salt form — pull out a known salt token, KEEP it (never discard)
  let saltForm: string | null = null;
  const keptTokens: string[] = [];
  for (const tok of residual.split(/[^a-z0-9]+/i).filter(Boolean)) {
    const salt = lex.saltForms.get(tok.toLowerCase());
    if (salt && saltForm === null) {
      saltForm = salt;
    } else {
      keptTokens.push(tok);
    }
  }

  // 3d. resolve molecule: exact synonym → trigram fallback → FAIL
  const name = keptTokens.join(' ').toLowerCase().trim();
  if (name === '') {
    return err({
      code: 'UNRESOLVED_MOLECULE',
      message: `no molecule token in "${raw}"`,
      component: raw,
    });
  }
  let molecule = lex.synonyms.get(name);
  if (!molecule) {
    const match = bestMatch(name, lex.synonyms.keys(), threshold);
    if (match) molecule = lex.synonyms.get(match.candidate);
  }
  if (!molecule) {
    return err({
      code: 'UNRESOLVED_MOLECULE',
      message: `unresolved molecule "${name}"`,
      component: raw,
    });
  }

  return ok({ molecule, strengthBase: base, strengthUnit: unit, saltForm });
}

export function normalise(
  raw: string,
  lex: Lexicon,
  opts: NormaliseOptions = {},
): Result<CanonicalFormulation, NormalisationError> {
  const threshold = opts.trigramThreshold ?? DEFAULT_THRESHOLD;
  if (!raw || raw.trim() === '') {
    return err({ code: 'EMPTY_INPUT', message: 'empty composition' });
  }

  const cleaned = stripPunctuation(raw.toLowerCase());
  const allTokens = cleaned.split(/[^a-z0-9]+/).filter(Boolean);

  // 4/5. dosage form + release from the whole string
  const dosage = detectDosageForm(allTokens, lex, opts.dosageFormHint);
  if (!dosage) {
    return err({ code: 'UNKNOWN_DOSAGE_FORM', message: `no dosage form in "${raw}"` });
  }
  const releaseType = detectRelease(allTokens, lex);

  // remove recognised form + release tokens so they don't pollute components
  const formTokens = new Set(lex.dosageForms.keys());
  const relTokens = new Set(lex.releaseModifiers.keys());
  const withoutMeta = cleaned
    .split(' ')
    .filter((t) => !formTokens.has(t) && !relTokens.has(t))
    .join(' ');

  const componentStrs = splitComponents(withoutMeta);
  if (componentStrs.length === 0) {
    return err({ code: 'NO_COMPONENTS', message: `no components in "${raw}"` });
  }

  const parsed: ParsedComponent[] = [];
  for (const cs of componentStrs) {
    const r = parseComponent(cs, lex, threshold);
    if (!r.ok) return r; // partial normalisation forbidden — fail the whole thing
    parsed.push(r.value);
  }

  // 6. deterministic sort by molecule id; assign ordinals
  parsed.sort((a, b) => a.molecule.id - b.molecule.id);
  const components: CanonicalComponent[] = parsed.map((p, i) => ({
    molecule: p.molecule,
    strengthBase: p.strengthBase,
    strengthUnit: p.strengthUnit,
    saltForm: p.saltForm,
    ordinal: i,
  }));

  // 7. build the canonical join key
  const key =
    `${dosage.form}|${releaseType}|` +
    components
      .map((c) => `${c.molecule.id}:${fmt(c.strengthBase)}:${c.strengthUnit}:${c.saltForm ?? '-'}`)
      .join(';');

  return ok({
    canonicalKey: key,
    dosageForm: dosage.form,
    releaseType,
    route: dosage.route,
    isFdc: components.length > 1,
    components,
  });
}
