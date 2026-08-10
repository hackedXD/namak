// Brand → formulation resolver: a three-tier cascade, cheapest tier first, with
// confidence gating (design §4.2). Pure except for an INJECTED adjudicator
// (the LLM tier), so the package has no I/O of its own.
//
// Precision over recall, deliberately (§12.3, target ≥ 0.98): every tier prefers
// to fall through to human review rather than emit a wrong mapping. The LLM is an
// ADJUDICATOR constrained to a candidate set — never a generator; it can only
// pick one of the supplied formulations or decline.

import type { FormulationRecord } from '@salt/domain';
import { normalise, type Lexicon } from '@salt/normalize';
import { rankCandidates, type ScoredCandidate } from './score.js';

export type ResolveMethod = 'deterministic' | 'fuzzy' | 'llm' | 'none';

export interface ProductInput {
  rawComposition: string;
  dosageFormHint?: string;
  manufacturer?: string;
  brand?: string;
  pack?: string;
}

export interface AdjudicationRequest {
  rawComposition: string;
  candidates: Array<{ formulationId: number; canonicalKey: string }>;
}
export interface AdjudicationResponse {
  choiceId: number | null; // MUST be one of the candidate ids, or null
  confidence: number; // 0..1
  reasoning?: string;
}
export type Adjudicator = (
  req: AdjudicationRequest,
) => AdjudicationResponse | Promise<AdjudicationResponse>;

export interface ResolveOptions {
  lexicon: Lexicon;
  formulations: readonly FormulationRecord[];
  /** Injected LLM tier. If absent, Tier 3 is skipped → human review. */
  adjudicator?: Adjudicator;
  /** Prior exact (manufacturer|brand|pack) → formulationId shortcut. */
  priorExact?: ReadonlyMap<string, number>;
  fuzzyAcceptScore?: number; // default 0.92
  fuzzyMargin?: number; // default 0.08 over runner-up
  llmAcceptConfidence?: number; // default 0.90
  trigramThreshold?: number;
}

export interface ResolveResult {
  formulationId: number | null;
  method: ResolveMethod;
  confidence: number;
  needsHumanReview: boolean;
  /** JSON, written verbatim to match_audit.evidence. */
  evidence: Record<string, unknown>;
}

function priorKey(p: ProductInput): string | null {
  if (!p.manufacturer || !p.brand || !p.pack) return null;
  return `${p.manufacturer.toLowerCase()}|${p.brand.toLowerCase()}|${p.pack}`;
}

function topN<T>(ranked: Array<ScoredCandidate<T>>, n: number) {
  return ranked.slice(0, n);
}

export async function resolve(
  product: ProductInput,
  opts: ResolveOptions,
): Promise<ResolveResult> {
  const acceptScore = opts.fuzzyAcceptScore ?? 0.92;
  const margin = opts.fuzzyMargin ?? 0.08;
  const llmConf = opts.llmAcceptConfidence ?? 0.9;

  // ── Tier 1a — prior exact match on manufacturer + brand + pack ──────────
  const pk = priorKey(product);
  if (opts.priorExact && pk) {
    const fid = opts.priorExact.get(pk);
    if (fid !== undefined) {
      return {
        formulationId: fid,
        method: 'deterministic',
        confidence: 1,
        needsHumanReview: false,
        evidence: { tier: 1, via: 'prior_exact', key: pk },
      };
    }
  }

  // ── Tier 1b — normalise → exact canonical_key match ─────────────────────
  const normOpts: Parameters<typeof normalise>[2] = {};
  if (product.dosageFormHint !== undefined) normOpts.dosageFormHint = product.dosageFormHint;
  if (opts.trigramThreshold !== undefined) normOpts.trigramThreshold = opts.trigramThreshold;
  const norm = normalise(product.rawComposition, opts.lexicon, normOpts);
  if (!norm.ok) {
    // Molecules could not be resolved — never guess. Straight to human review.
    return {
      formulationId: null,
      method: 'none',
      confidence: 0,
      needsHumanReview: true,
      evidence: { tier: 1, via: 'normalise_failed', error: norm.error },
    };
  }
  const cf = norm.value;

  const exact = opts.formulations.find((f) => f.canonicalKey === cf.canonicalKey);
  if (exact) {
    return {
      formulationId: exact.id,
      method: 'deterministic',
      confidence: 1,
      needsHumanReview: false,
      evidence: { tier: 1, via: 'canonical_key', canonicalKey: cf.canonicalKey },
    };
  }

  // ── Tier 2 — fuzzy blocking + scoring ───────────────────────────────────
  const ranked = rankCandidates(cf, opts.formulations);
  const best = ranked[0];
  const runner = ranked[1];
  const top5 = topN(ranked, 5).map((r) => ({
    formulationId: r.candidate.id,
    canonicalKey: r.candidate.canonicalKey,
    score: Number(r.score.toFixed(4)),
    parts: r.parts,
  }));

  // PRECISION GATE (safety, beyond the design's score threshold): auto-accept a
  // fuzzy candidate ONLY when the molecule set is identical AND every shared
  // component's strength/salt/unit matches exactly. Without this, a lone blocked
  // candidate at a near-but-different strength (e.g. amlodipine 6 mg vs 5 mg)
  // would pass the 0.92 threshold with no runner-up to trip the margin check and
  // be mis-mapped — a precision violation. Non-exact candidates fall through to
  // the LLM/human tier. This keeps Tier-2 auto-accept effectively a structural
  // match (robust to canonical_key string drift) without ever guessing strength.
  const structurallyExact = best !== undefined && best.parts.strength === 1 && best.parts.jaccard === 1;

  if (
    best &&
    structurallyExact &&
    best.score >= acceptScore &&
    (runner === undefined || best.score - runner.score >= margin)
  ) {
    return {
      formulationId: best.candidate.id,
      method: 'fuzzy',
      confidence: Number(best.score.toFixed(4)),
      needsHumanReview: false,
      evidence: {
        tier: 2,
        canonicalKey: cf.canonicalKey,
        score: Number(best.score.toFixed(4)),
        parts: best.parts,
        marginOverRunnerUp: runner ? Number((best.score - runner.score).toFixed(4)) : null,
        candidates: top5,
      },
    };
  }

  // ── Tier 3 — LLM adjudication, constrained to the candidate set ─────────
  if (opts.adjudicator && top5.length > 0) {
    const resp = await opts.adjudicator({
      rawComposition: product.rawComposition,
      candidates: top5.map((c) => ({ formulationId: c.formulationId, canonicalKey: c.canonicalKey })),
    });
    const validIds = new Set(top5.map((c) => c.formulationId));
    const accepted =
      resp.choiceId !== null && validIds.has(resp.choiceId) && resp.confidence >= llmConf;
    if (accepted) {
      return {
        formulationId: resp.choiceId,
        method: 'llm',
        confidence: resp.confidence,
        needsHumanReview: false,
        evidence: {
          tier: 3,
          canonicalKey: cf.canonicalKey,
          llmConfidence: resp.confidence,
          reasoning: resp.reasoning ?? null,
          candidates: top5,
        },
      };
    }
    // declined / low-confidence / tried to invent → human review
    return {
      formulationId: null,
      method: 'none',
      confidence: 0,
      needsHumanReview: true,
      evidence: {
        tier: 3,
        via: 'llm_declined',
        llm: { choiceId: resp.choiceId, confidence: resp.confidence },
        candidates: top5,
      },
    };
  }

  // ── Human review queue ──────────────────────────────────────────────────
  return {
    formulationId: null,
    method: 'none',
    confidence: best ? Number(best.score.toFixed(4)) : 0,
    needsHumanReview: true,
    evidence: {
      tier: 2,
      via: top5.length ? 'fuzzy_below_threshold' : 'no_candidates',
      canonicalKey: cf.canonicalKey,
      candidates: top5,
    },
  };
}
