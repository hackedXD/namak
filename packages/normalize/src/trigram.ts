// Trigram similarity for fuzzy molecule matching (§4.1 step 3d fallback).
// Dice coefficient over padded 3-grams — the same idea as Postgres pg_trgm,
// which we'll use at Stage 2. Pure, deterministic.

/** Padded trigrams of a string: each token is padded so short names still
 *  produce stable grams. Non-alphanumerics split tokens. */
export function trigrams(input: string): Set<string> {
  const grams = new Set<string>();
  const tokens = input.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const tok of tokens) {
    const padded = `  ${tok} `;
    for (let i = 0; i < padded.length - 2; i++) {
      grams.add(padded.slice(i, i + 3));
    }
  }
  return grams;
}

/** Dice similarity in [0,1]. 1.0 = identical trigram sets. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

/** Best match for `query` among `candidates` at or above `threshold`.
 *  Ties are broken by the lexicographically smallest candidate for
 *  determinism. Returns null if nothing clears the bar. */
export function bestMatch(
  query: string,
  candidates: Iterable<string>,
  threshold: number,
): { candidate: string; score: number } | null {
  let best: { candidate: string; score: number } | null = null;
  for (const cand of candidates) {
    const score = similarity(query, cand);
    if (score < threshold) continue;
    if (
      best === null ||
      score > best.score ||
      (score === best.score && cand < best.candidate)
    ) {
      best = { candidate: cand, score };
    }
  }
  return best;
}
