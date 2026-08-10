// Enforcement: EVERY molecule in the curated NTI list (design §4.3, §12.3
// "every NTI molecule has an explicit test") must yield CONSULT_REQUIRED and must
// never allow a switch CTA. The list is read from the source-of-record artifact
// data/nti_molecules.yaml, so adding a molecule there automatically adds a case.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { assessEquivalence, allowsSwitchCta } from './assess.js';
import { mol, comp, formulation } from './test-helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const NTI_PATH = join(here, '..', '..', '..', 'data', 'nti_molecules.yaml');

interface NtiDoc {
  reviewed_by: string;
  molecules: Array<{ inn: string; reason?: string }>;
  classes?: Array<{ name: string; members: string[] }>;
}

const doc = yaml.load(readFileSync(NTI_PATH, 'utf8')) as NtiDoc;

function allNtiInns(): string[] {
  const explicit = doc.molecules.map((m) => m.inn);
  const classMembers = (doc.classes ?? []).flatMap((c) => c.members);
  return [...new Set([...explicit, ...classMembers])];
}

const REQUIRED_MINIMUM = [
  'warfarin', 'levothyroxine', 'phenytoin', 'carbamazepine', 'valproate',
  'lithium', 'digoxin', 'theophylline', 'ciclosporin', 'tacrolimus',
  'sirolimus', 'mycophenolate', 'procainamide',
];

describe('NTI curated list', () => {
  it('contains the design §4.3 minimum set', () => {
    const inns = new Set(doc.molecules.map((m) => m.inn));
    for (const required of REQUIRED_MINIMUM) expect(inns).toContain(required);
  });

  it('includes antiretroviral and anti-tubercular class members', () => {
    const all = new Set(allNtiInns());
    expect(all).toContain('dolutegravir');
    expect(all).toContain('rifampicin');
  });

  it('is flagged as awaiting named clinical sign-off (U6) until reviewed', () => {
    // A guard: while unreviewed, reviewed_by must be PENDING so nobody mistakes
    // this draft for a clinically-signed artifact. Update this test when signed.
    expect(doc.reviewed_by).toBe('PENDING');
  });
});

describe('every NTI molecule → CONSULT_REQUIRED, never a switch CTA', () => {
  const inns = allNtiInns();
  it('the list is non-trivial', () => {
    expect(inns.length).toBeGreaterThanOrEqual(17);
  });

  for (const [i, inn] of inns.entries()) {
    it(`NTI: ${inn}`, () => {
      const m = mol(1000 + i, inn, true); // flagged NTI (as the lexicon would)
      const f = formulation([comp(m, 10)]);
      const r = assessEquivalence(f, formulation([comp(m, 10)]));
      expect(r.verdict).toBe('CONSULT_REQUIRED');
      expect(r.reasonCode).toBe('NTI_DRUG');
      expect(allowsSwitchCta(r)).toBe(false);
    });
  }
});
