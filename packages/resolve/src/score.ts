// Tier-2 fuzzy scoring (§4.2). Pure.
//
// DEVIATION FROM THE DESIGN, DELIBERATE: the design specifies
// "0.30 × strength vector cosine (log-scaled)". Cosine is degenerate for
// single-molecule formulations — the cosine of two 1-D vectors is always 1.0, so
// it cannot distinguish amlodipine 5 mg from 2.5 mg. That would let the resolver
// map different strengths together and violate the precision ≥ 0.98 mandate
// (§12.3). We instead use a magnitude- AND salt-aware strength closeness that
// actually penalises strength/salt differences. Same 0.30 weight; safer behaviour.

import type { CanonicalComponent, CanonicalFormulation } from '@salt/domain';

export interface ScoreParts {
  jaccard: number;
  strength: number;
  form: number;
  release: number;
}

export interface ScoredCandidate<T> {
  candidate: T;
  score: number;
  parts: ScoreParts;
}

const W = { jaccard: 0.5, strength: 0.3, form: 0.1, release: 0.1 };

export function moleculeIds(f: CanonicalFormulation): Set<number> {
  return new Set(f.components.map((c) => c.molecule.id));
}

export function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function componentByMolecule(f: CanonicalFormulation): Map<number, CanonicalComponent> {
  return new Map(f.components.map((c) => [c.molecule.id, c]));
}

/**
 * Strength closeness over the SHARED molecules, salt- and unit-aware:
 *   - different salt form or unit ⇒ that component contributes 0 (they are not
 *     the same component — succinate ≠ tartrate);
 *   - otherwise the ratio min(a,b)/max(a,b) (1.0 when strengths are equal,
 *     decaying as they diverge).
 * Averaged over the shared molecules; 0 if none are shared.
 */
export function strengthCloseness(
  a: CanonicalFormulation,
  b: CanonicalFormulation,
): number {
  const bm = componentByMolecule(b);
  const shared: number[] = [];
  for (const ca of a.components) {
    const cb = bm.get(ca.molecule.id);
    if (!cb) continue;
    if (ca.saltForm !== cb.saltForm || ca.strengthUnit !== cb.strengthUnit) {
      shared.push(0);
      continue;
    }
    const hi = Math.max(ca.strengthBase, cb.strengthBase);
    const lo = Math.min(ca.strengthBase, cb.strengthBase);
    shared.push(hi === 0 ? (lo === 0 ? 1 : 0) : lo / hi);
  }
  if (shared.length === 0) return 0;
  return shared.reduce((s, x) => s + x, 0) / shared.length;
}

export function scoreCandidate(
  product: CanonicalFormulation,
  candidate: CanonicalFormulation,
): ScoreParts & { score: number } {
  const parts: ScoreParts = {
    jaccard: jaccard(moleculeIds(product), moleculeIds(candidate)),
    strength: strengthCloseness(product, candidate),
    form: product.dosageForm === candidate.dosageForm ? 1 : 0,
    release: product.releaseType === candidate.releaseType ? 1 : 0,
  };
  const score =
    W.jaccard * parts.jaccard +
    W.strength * parts.strength +
    W.form * parts.form +
    W.release * parts.release;
  return { ...parts, score };
}

/**
 * Blocking (§4.2): keep only candidates that share ≥1 molecule AND have the same
 * dosage form AND the same component count. Cheap pre-filter before scoring.
 */
export function blockCandidates<T extends CanonicalFormulation>(
  product: CanonicalFormulation,
  formulations: readonly T[],
): T[] {
  const pmol = moleculeIds(product);
  const pcount = product.components.length;
  return formulations.filter((f) => {
    if (f.components.length !== pcount) return false;
    if (f.dosageForm !== product.dosageForm) return false;
    for (const c of f.components) if (pmol.has(c.molecule.id)) return true;
    return false;
  });
}

/** Score all blocked candidates, best score first (stable tie-break by score). */
export function rankCandidates<T extends CanonicalFormulation>(
  product: CanonicalFormulation,
  formulations: readonly T[],
): Array<ScoredCandidate<T>> {
  return blockCandidates(product, formulations)
    .map((candidate) => {
      const { score, ...parts } = scoreCandidate(product, candidate);
      return { candidate, score, parts };
    })
    .sort((x, y) => y.score - x.score);
}
