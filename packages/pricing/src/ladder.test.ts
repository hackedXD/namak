import { describe, it, expect } from 'vitest';
import { buildLadder } from './ladder.js';
import type { CandidateProduct, LadderInput } from './types.js';
import type { CanonicalComponent, CanonicalFormulation, MoleculeRef } from '@salt/domain';

// Prices below are the design's Appendix A worked example — illustrative inputs
// for exercising the ranking/ceiling/overcharge ARITHMETIC, not asserted market
// prices. The formulation structure (paracetamol 650 tablet) is real.
const paracetamol: MoleculeRef = { id: 317, innName: 'paracetamol', isNti: false };

function formulation(
  components: CanonicalComponent[],
  o: { dosageForm?: string; releaseType?: 'IR' | 'SR'; route?: string } = {},
): CanonicalFormulation {
  const dosageForm = o.dosageForm ?? 'tablet';
  const releaseType = o.releaseType ?? 'IR';
  const route = o.route ?? 'oral';
  const key =
    `${dosageForm}|${releaseType}|` +
    components.map((c) => `${c.molecule.id}:${c.strengthBase}:${c.strengthUnit}:${c.saltForm ?? '-'}`).join(';');
  return { canonicalKey: key, dosageForm, releaseType, route, isFdc: components.length > 1, components };
}

const para650 = formulation([
  { molecule: paracetamol, strengthBase: 650, strengthUnit: 'mg', saltForm: null, ordinal: 0 },
]);

function product(
  id: number,
  brand: string,
  channelId: string,
  packSize: number,
  mrp: number,
  f: CanonicalFormulation = para650,
  extra: Partial<CandidateProduct> = {},
): CandidateProduct {
  return {
    productId: id,
    brandName: brand,
    channelId,
    packSize,
    packUnit: 'tablet',
    mrp,
    formulation: f,
    provenance: { sourceId: 'ipdms', snapshotDate: '2026-07-28' },
    ...extra,
  };
}

const CHANNEL_TIER = { jan_aushadhi: 1, unbranded: 2, branded: 3, epharmacy: 4 };

// Appendix A products, all on the same formulation (all EXACT_MATCH).
const appendixInput: LadderInput = {
  formulation: para650,
  candidates: [
    product(1, 'Dolo 650', 'branded', 15, 31.5),
    product(2, 'Calpol 650', 'branded', 15, 29.0),
    product(3, 'Paracetamol', 'unbranded', 10, 11.0),
    product(4, 'PMBJP Para650', 'jan_aushadhi', 10, 2.8),
  ],
  ceiling: { ceilingPerUnit: 2.09, gstPct: 12, notificationNo: 'S.O.3869(E)', notificationDate: '2022-11-01' },
  quantityNeeded: 30,
  channelTier: CHANNEL_TIER,
  asOf: '2026-07-28',
};

describe('buildLadder — Appendix A worked example', () => {
  const ladder = buildLadder(appendixInput);

  it('ranks by effectiveCost for the quantity needed', () => {
    expect(ladder.ladder.map((r) => r.product.brandName)).toEqual([
      'PMBJP Para650',
      'Paracetamol',
      'Calpol 650',
      'Dolo 650',
    ]);
  });

  it('computes effectiveCost = ceil(qty/pack) × mrp', () => {
    const byBrand = Object.fromEntries(ladder.ladder.map((r) => [r.product.brandName, r]));
    expect(byBrand['PMBJP Para650']!.effectiveCost).toBe(8.4); // 3 × 2.80
    expect(byBrand['Paracetamol']!.effectiveCost).toBe(33.0); // 3 × 11.00
    expect(byBrand['Calpol 650']!.effectiveCost).toBe(58.0); // 2 × 29.00
    expect(byBrand['Dolo 650']!.effectiveCost).toBe(63.0); // 2 × 31.50
  });

  it('legal maximum = ceilingPerUnit × (1 + GST)', () => {
    expect(ladder.legalMaxPerUnit).toBe(2.34); // 2.09 × 1.12
    expect(ladder.ceilingCitation).toBe('S.O.3869(E)');
  });

  it('top saving is costliest − cheapest', () => {
    expect(ladder.topSaving).toBe(54.6); // 63.00 − 8.40
  });

  it('every row carries provenance and no branded price is over the ceiling', () => {
    for (const r of ladder.ladder) {
      expect(r.provenance.sourceId).toBe('ipdms');
      expect(r.overCeiling).toBe(false);
    }
  });
});

describe('buildLadder — key decisions', () => {
  it('ranks by effectiveCost, NOT unit price', () => {
    // A: 100-pack cheap per unit but you must buy the whole pack; B: small pack.
    const A = product(10, 'BigPack', 'unbranded', 100, 50); // unit 0.50, need 10 → 1 pack ₹50
    const B = product(11, 'SmallPack', 'unbranded', 10, 8); // unit 0.80, need 10 → 1 pack ₹8
    const l = buildLadder({
      formulation: para650,
      candidates: [A, B],
      ceiling: null,
      quantityNeeded: 10,
      channelTier: CHANNEL_TIER,
    });
    expect(l.ladder[0]!.product.brandName).toBe('SmallPack'); // lower effectiveCost wins
    expect(l.ladder[0]!.unitPrice).toBeGreaterThan(l.ladder[1]!.unitPrice); // despite higher unit price
  });

  it('separates NOT_INTERCHANGEABLE candidates (different strength) from the ladder', () => {
    const para500 = formulation([
      { molecule: paracetamol, strengthBase: 500, strengthUnit: 'mg', saltForm: null, ordinal: 0 },
    ]);
    const l = buildLadder({
      formulation: para650,
      candidates: [
        product(1, 'Dolo 650', 'branded', 15, 31.5),
        product(5, 'Para 500', 'branded', 15, 20, para500),
      ],
      ceiling: null,
      quantityNeeded: 15,
      channelTier: CHANNEL_TIER,
    });
    expect(l.ladder.map((r) => r.product.brandName)).toEqual(['Dolo 650']);
    expect(l.notInterchangeable.map((r) => r.product.brandName)).toEqual(['Para 500']);
    expect(l.notInterchangeable[0]!.equivalence.reasonCode).toBe('STRENGTH_MISMATCH');
  });

  it('keeps an NTI candidate in the ladder but as CONSULT (never blocked)', () => {
    const warfarin: MoleculeRef = { id: 900, innName: 'warfarin', isNti: true };
    const w5 = formulation([{ molecule: warfarin, strengthBase: 5, strengthUnit: 'mg', saltForm: null, ordinal: 0 }]);
    const l = buildLadder({
      formulation: w5,
      candidates: [product(20, 'BrandW', 'branded', 30, 100, w5)],
      ceiling: null,
      quantityNeeded: 30,
      channelTier: CHANNEL_TIER,
    });
    expect(l.ladder).toHaveLength(1);
    expect(l.ladder[0]!.equivalence.verdict).toBe('CONSULT_REQUIRED');
    expect(l.notInterchangeable).toHaveLength(0);
  });

  it('active recall drops a candidate into the not-interchangeable section', () => {
    const l = buildLadder({
      formulation: para650,
      candidates: [product(30, 'Recalled', 'branded', 15, 20, para650, { hasActiveRecall: true })],
      ceiling: null,
      quantityNeeded: 15,
      channelTier: CHANNEL_TIER,
    });
    expect(l.ladder).toHaveLength(0);
    expect(l.notInterchangeable[0]!.equivalence.reasonCode).toBe('ACTIVE_RECALL');
  });

  it('is deterministic — same input, identical output (no personalisation)', () => {
    expect(buildLadder(appendixInput)).toEqual(buildLadder(appendixInput));
  });

  it('breaks cost ties stably by product id', () => {
    const l = buildLadder({
      formulation: para650,
      candidates: [product(9, 'B', 'branded', 10, 10), product(3, 'A', 'branded', 10, 10)],
      ceiling: null,
      quantityNeeded: 10,
      channelTier: CHANNEL_TIER,
    });
    expect(l.ladder.map((r) => r.product.productId)).toEqual([3, 9]);
  });
});

describe('buildLadder — overcharge check', () => {
  it('flags a quoted price above the legal maximum', () => {
    const l = buildLadder({ ...appendixInput, quotedUnitPrice: 3.0 });
    expect(l.overcharge).toMatchObject({ isOvercharge: true, overByPerUnit: 0.66 });
    expect(l.overcharge!.overByTotal).toBe(19.8); // 0.66 × 30
  });

  it('does not flag a quoted price at or below the legal maximum', () => {
    const l = buildLadder({ ...appendixInput, quotedUnitPrice: 2.1 });
    expect(l.overcharge!.isOvercharge).toBe(false);
  });

  it('is null when no ceiling or no quote', () => {
    expect(buildLadder(appendixInput).overcharge).toBeNull();
    expect(buildLadder({ ...appendixInput, ceiling: null, quotedUnitPrice: 3 }).overcharge).toBeNull();
  });
});
