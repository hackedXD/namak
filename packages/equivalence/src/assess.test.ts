import { describe, it, expect } from 'vitest';
import { assessEquivalence, allowsSwitchCta } from './assess.js';
import { mol, comp, formulation } from './test-helpers.js';

// real molecules
const paracetamol = mol(1, 'paracetamol');
const ibuprofen = mol(2, 'ibuprofen');
const metoprolol = mol(4, 'metoprolol');
const warfarin = mol(10, 'warfarin', true); // NTI

const para650 = formulation([comp(paracetamol, 650)]);

describe('assessEquivalence — every gate, in order (branch coverage)', () => {
  it('Gate 0: identical → INTERCHANGEABLE / EXACT_MATCH', () => {
    const r = assessEquivalence(para650, formulation([comp(paracetamol, 650)]));
    expect(r).toMatchObject({ verdict: 'INTERCHANGEABLE', reasonCode: 'EXACT_MATCH', ruleIds: [0] });
  });

  it('Gate 1: different molecule → NOT_INTERCHANGEABLE / MOLECULE_MISMATCH', () => {
    const r = assessEquivalence(para650, formulation([comp(ibuprofen, 650)]));
    expect(r).toMatchObject({ verdict: 'NOT_INTERCHANGEABLE', reasonCode: 'MOLECULE_MISMATCH' });
  });

  it('Gate 2: different strength → NOT_INTERCHANGEABLE / STRENGTH_MISMATCH', () => {
    const r = assessEquivalence(para650, formulation([comp(paracetamol, 500)]));
    expect(r).toMatchObject({ verdict: 'NOT_INTERCHANGEABLE', reasonCode: 'STRENGTH_MISMATCH' });
  });

  it('Gate 3: NTI molecule → CONSULT_REQUIRED / NTI_DRUG', () => {
    const w = formulation([comp(warfarin, 5)]);
    const r = assessEquivalence(w, formulation([comp(warfarin, 5)]));
    expect(r).toMatchObject({ verdict: 'CONSULT_REQUIRED', reasonCode: 'NTI_DRUG', ruleIds: [3] });
  });

  it('Gate 4: release mismatch (non-NTI) → NOT_INTERCHANGEABLE / RELEASE_MISMATCH', () => {
    const ir = formulation([comp(metoprolol, 50, { salt: 'succinate' })]);
    const sr = formulation([comp(metoprolol, 50, { salt: 'succinate' })], { releaseType: 'SR' });
    expect(assessEquivalence(ir, sr).reasonCode).toBe('RELEASE_MISMATCH');
  });

  it('Gate 5: salt form differs (non-NTI) → CONSULT_REQUIRED / SALT_FORM_DIFFERS', () => {
    const succ = formulation([comp(metoprolol, 50, { salt: 'succinate' })]);
    const tart = formulation([comp(metoprolol, 50, { salt: 'tartrate' })]);
    expect(assessEquivalence(succ, tart)).toMatchObject({
      verdict: 'CONSULT_REQUIRED',
      reasonCode: 'SALT_FORM_DIFFERS',
    });
  });

  it('Gate 6a: route mismatch → NOT_INTERCHANGEABLE / ROUTE_MISMATCH', () => {
    const oral = formulation([comp(paracetamol, 650)], { route: 'oral' });
    const iv = formulation([comp(paracetamol, 650)], { route: 'parenteral', dosageForm: 'injection' });
    expect(assessEquivalence(oral, iv).reasonCode).toBe('ROUTE_MISMATCH');
  });

  it('Gate 6b: tablet↔capsule (both oral solid) stays INTERCHANGEABLE', () => {
    const tab = formulation([comp(paracetamol, 650)], { dosageForm: 'tablet' });
    const cap = formulation([comp(paracetamol, 650)], { dosageForm: 'capsule' });
    expect(assessEquivalence(tab, cap).verdict).toBe('INTERCHANGEABLE');
  });

  it('Gate 6c: tablet vs syrup (same route) → CONSULT_REQUIRED / FORM_DIFFERS', () => {
    const tab = formulation([comp(paracetamol, 650)], { dosageForm: 'tablet' });
    const syr = formulation([comp(paracetamol, 650)], { dosageForm: 'syrup' });
    expect(assessEquivalence(tab, syr).reasonCode).toBe('FORM_DIFFERS');
  });

  it('Gate 7: active recall on candidate → NOT_INTERCHANGEABLE / ACTIVE_RECALL', () => {
    const r = assessEquivalence(para650, formulation([comp(paracetamol, 650)]), {
      candidateHasActiveRecall: true,
    });
    expect(r).toMatchObject({ verdict: 'NOT_INTERCHANGEABLE', reasonCode: 'ACTIVE_RECALL' });
  });
});

describe('assessEquivalence — gate ORDER (first firing gate wins)', () => {
  it('molecule/strength mismatch is decided before NTI', () => {
    const w5 = formulation([comp(warfarin, 5)]);
    const w3 = formulation([comp(warfarin, 3)]);
    // NTI, but strengths differ → STRENGTH_MISMATCH (Gate 2 before Gate 3)
    expect(assessEquivalence(w5, w3).reasonCode).toBe('STRENGTH_MISMATCH');
  });

  it('NTI is decided before salt/release/form', () => {
    // same molecule+strength, NTI, but salt differs → NTI wins (Gate 3 before 5)
    const a = formulation([comp(warfarin, 5, { salt: 'sodium' })]);
    const b = formulation([comp(warfarin, 5, { salt: null })]);
    expect(assessEquivalence(a, b).reasonCode).toBe('NTI_DRUG');
  });
});

describe('allowsSwitchCta — no "switch and save" except exact interchangeability', () => {
  it('true only for INTERCHANGEABLE', () => {
    expect(allowsSwitchCta(assessEquivalence(para650, formulation([comp(paracetamol, 650)])))).toBe(true);
  });
  it('false for NTI (CONSULT)', () => {
    const w = formulation([comp(warfarin, 5)]);
    expect(allowsSwitchCta(assessEquivalence(w, formulation([comp(warfarin, 5)])))).toBe(false);
  });
  it('false for NOT_INTERCHANGEABLE', () => {
    expect(allowsSwitchCta(assessEquivalence(para650, formulation([comp(ibuprofen, 650)])))).toBe(false);
  });
});
