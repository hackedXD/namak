import { describe, it, expect } from 'vitest';
import { jaccard, strengthCloseness, blockCandidates, scoreCandidate, moleculeIds } from './score.js';
import { FORMULATIONS, mkFormulation } from './test-fixtures.js';

const amlo5 = mkFormulation(1, 'Amlodipine 5mg Tablet');
const amlo6 = mkFormulation(2, 'Amlodipine 6mg Tablet');
const metoSucc = mkFormulation(3, 'Metoprolol Succinate 50mg Tablet');
const metoTart = mkFormulation(4, 'Metoprolol Tartrate 50mg Tablet');

describe('jaccard', () => {
  it('is 1 for identical molecule sets, 0 for disjoint', () => {
    expect(jaccard(moleculeIds(amlo5), moleculeIds(amlo6))).toBe(1);
    expect(jaccard(new Set([1]), new Set([2]))).toBe(0);
    expect(jaccard(new Set([1, 2]), new Set([2, 3]))).toBeCloseTo(1 / 3);
  });
});

describe('strengthCloseness', () => {
  it('is 1.0 for identical strength + salt', () => {
    expect(strengthCloseness(amlo5, mkFormulation(9, 'Amlodipine 5mg Tablet'))).toBe(1);
  });
  it('decays with strength ratio (5 vs 6 → 5/6)', () => {
    expect(strengthCloseness(amlo5, amlo6)).toBeCloseTo(5 / 6);
  });
  it('is 0 when salt forms differ (succinate vs tartrate)', () => {
    expect(strengthCloseness(metoSucc, metoTart)).toBe(0);
  });
});

describe('blockCandidates', () => {
  it('keeps only same-form, same-component-count, ≥1 shared molecule', () => {
    const blocked = blockCandidates(amlo5, FORMULATIONS);
    const ids = blocked.map((f) => f.id).sort();
    // amlodipine 5mg (1005) shares molecule + count 1; the FDC 1007 has count 2 → excluded
    expect(ids).toEqual([1005]);
  });
});

describe('scoreCandidate weights sum correctly', () => {
  it('identical formulations score 1.0', () => {
    const { score } = scoreCandidate(amlo5, mkFormulation(9, 'Amlodipine 5mg Tablet'));
    expect(score).toBeCloseTo(1);
  });
  it('different strength: strength part is penalised, yet the RAW score still clears 0.92 — which is exactly why resolve() adds an exact-strength precision gate', () => {
    const s = scoreCandidate(amlo5, amlo6); // 0.5 + 0.3*(5/6) + 0.1 + 0.1 = 0.95
    expect(s.strength).toBeLessThan(1);
    expect(s.score).toBeGreaterThanOrEqual(0.92); // the danger the gate defends against
  });
});
