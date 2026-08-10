// Equivalence & substitution safety engine (design §4.3). Pure, deterministic.
//
// Given a source formulation and a candidate, return a verdict a pharmacist would
// defend. The gates run in a fixed order and the FIRST one that fires wins — the
// order encodes clinical priority (a molecule/strength mismatch is decided before
// we even consider NTI status; NTI is decided before release/salt/form niceties).
//
// FAIL CLOSED (§1.1 #4): when in doubt we down-rank to CONSULT_REQUIRED or
// NOT_INTERCHANGEABLE, never up to INTERCHANGEABLE.
//
// Recall status is EXTERNAL data (the `recall` table), so it is injected via
// context to keep this engine pure and exhaustively testable.

import type { CanonicalFormulation } from '@salt/domain';
import { RULES, type Rule, type Verdict } from './rules.js';

export interface EquivalenceResult {
  verdict: Verdict;
  reasonCode: string;
  displayMessage: string;
  ruleIds: number[];
}

export interface EquivalenceContext {
  /** Whether the candidate product currently has an active recall (§4.3 Gate 7). */
  candidateHasActiveRecall?: boolean;
}

// Tablet↔capsule is usually fine orally; anything crossing route is not.
const ORAL_SOLID = new Set(['tablet', 'capsule']);

function toResult(rule: Rule): EquivalenceResult {
  return {
    verdict: rule.verdict,
    reasonCode: rule.code,
    displayMessage: rule.displayMessage,
    ruleIds: [rule.id],
  };
}

function strengthByMolecule(f: CanonicalFormulation) {
  return new Map(f.components.map((c) => [c.molecule.id, c]));
}

function moleculeSetEqual(a: CanonicalFormulation, b: CanonicalFormulation): boolean {
  if (a.components.length !== b.components.length) return false;
  const bs = new Set(b.components.map((c) => c.molecule.id));
  return a.components.every((c) => bs.has(c.molecule.id));
}

function strengthsEqual(a: CanonicalFormulation, b: CanonicalFormulation): boolean {
  const bm = strengthByMolecule(b);
  for (const ca of a.components) {
    const cb = bm.get(ca.molecule.id);
    if (!cb) return false;
    if (ca.strengthBase !== cb.strengthBase || ca.strengthUnit !== cb.strengthUnit) return false;
  }
  return true;
}

function saltFormsEqual(a: CanonicalFormulation, b: CanonicalFormulation): boolean {
  const bm = strengthByMolecule(b);
  for (const ca of a.components) {
    const cb = bm.get(ca.molecule.id);
    if (!cb) return false;
    if ((ca.saltForm ?? null) !== (cb.saltForm ?? null)) return false;
  }
  return true;
}

export function assessEquivalence(
  src: CanonicalFormulation,
  cand: CanonicalFormulation,
  ctx: EquivalenceContext = {},
): EquivalenceResult {
  // Gate 1 — molecule set must match exactly.
  if (!moleculeSetEqual(src, cand)) return toResult(RULES.MOLECULE_MISMATCH);

  // Gate 2 — strengths must match exactly, per component.
  if (!strengthsEqual(src, cand)) return toResult(RULES.STRENGTH_MISMATCH);

  // Gate 3 — NTI drugs are never auto-substituted (price still shown, switch not
  // endorsed). Checked on the SOURCE molecules.
  if (src.components.some((c) => c.molecule.isNti === true)) return toResult(RULES.NTI_DRUG);

  // Gate 4 — release profile must match (SR ≠ IR).
  if (src.releaseType !== cand.releaseType) return toResult(RULES.RELEASE_MISMATCH);

  // Gate 5 — salt form. Same salt = fine. Different salt = clinician call.
  if (!saltFormsEqual(src, cand)) return toResult(RULES.SALT_FORM_DIFFERS);

  // Gate 6 — route, then dosage form.
  if (src.route !== cand.route) return toResult(RULES.ROUTE_MISMATCH);
  if (
    src.dosageForm !== cand.dosageForm &&
    !(ORAL_SOLID.has(src.dosageForm) && ORAL_SOLID.has(cand.dosageForm))
  ) {
    return toResult(RULES.FORM_DIFFERS);
  }

  // Gate 7 — active recall on the candidate.
  if (ctx.candidateHasActiveRecall === true) return toResult(RULES.ACTIVE_RECALL);

  return toResult(RULES.EXACT_MATCH);
}

/** Convenience: is this verdict safe to present with a "switch and save" CTA?
 *  Only exact interchangeability qualifies — NTI and any non-exact do not (§4.3). */
export function allowsSwitchCta(result: EquivalenceResult): boolean {
  return result.verdict === 'INTERCHANGEABLE';
}
