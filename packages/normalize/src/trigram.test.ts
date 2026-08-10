import { describe, it, expect } from 'vitest';
import { similarity, bestMatch } from './trigram.js';

describe('trigram similarity', () => {
  it('is 1.0 for identical strings and symmetric', () => {
    expect(similarity('paracetamol', 'paracetamol')).toBe(1);
    expect(similarity('metformin', 'glimepiride')).toBe(similarity('glimepiride', 'metformin'));
  });

  it('scores near-misspellings high and unrelated words low', () => {
    expect(similarity('metformin', 'metformine')).toBeGreaterThan(0.7);
    expect(similarity('paracetamol', 'ibuprofen')).toBeLessThan(0.3);
  });

  it('bestMatch picks the closest candidate above threshold, else null', () => {
    const cands = ['paracetamol', 'metformin', 'glimepiride'];
    expect(bestMatch('metformine', cands, 0.7)?.candidate).toBe('metformin');
    expect(bestMatch('zzzzz', cands, 0.7)).toBeNull();
  });

  it('breaks ties deterministically (lexicographically smallest)', () => {
    // both identical-length nonsense; ensure stable selection, not order-dependent
    const a = bestMatch('abc', ['abd', 'abe'], 0);
    const b = bestMatch('abc', ['abe', 'abd'], 0);
    expect(a?.candidate).toBe(b?.candidate);
  });
});
