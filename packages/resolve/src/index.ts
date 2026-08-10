// @salt/resolve — §4.2 brand→formulation resolver cascade. Pure; LLM injected.
export { resolve } from './resolve.js';
export type {
  ProductInput,
  ResolveOptions,
  ResolveResult,
  ResolveMethod,
  Adjudicator,
  AdjudicationRequest,
  AdjudicationResponse,
} from './resolve.js';
export {
  scoreCandidate,
  rankCandidates,
  blockCandidates,
  jaccard,
  strengthCloseness,
  moleculeIds,
} from './score.js';
export type { ScoreParts, ScoredCandidate } from './score.js';
