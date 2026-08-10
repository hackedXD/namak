import { describe, it, expect } from 'vitest';
import { legalMaxPerUnit, computeOvercharge } from './overcharge.js';

describe('legalMaxPerUnit', () => {
  it('applies GST to the ceiling', () => {
    expect(legalMaxPerUnit(2.09, 12)).toBeCloseTo(2.3408);
    expect(legalMaxPerUnit(10, 0)).toBe(10);
  });
});

describe('computeOvercharge', () => {
  it('reports the per-unit and total overcharge when quoted above the legal max', () => {
    const o = computeOvercharge(3.0, 2.34, 30);
    expect(o.isOvercharge).toBe(true);
    expect(o.overByPerUnit).toBe(0.66);
    expect(o.overByTotal).toBe(19.8);
  });

  it('is not an overcharge at or below the legal max', () => {
    expect(computeOvercharge(2.34, 2.34, 10).isOvercharge).toBe(false);
    expect(computeOvercharge(2.0, 2.34, 10).isOvercharge).toBe(false);
    expect(computeOvercharge(2.0, 2.34, 10).overByPerUnit).toBeLessThan(0);
  });
});
