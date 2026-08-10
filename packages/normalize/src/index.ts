// @salt/normalize — §4.1 composition normalisation engine. Pure, zero I/O.
export { normalise } from './normalise.js';
export type {
  NormalisationError,
  NormalisationErrorCode,
  NormaliseOptions,
} from './normalise.js';
export { buildLexicon } from './lexicon.js';
export type { Lexicon } from './lexicon.js';
export { similarity, trigrams, bestMatch } from './trigram.js';
