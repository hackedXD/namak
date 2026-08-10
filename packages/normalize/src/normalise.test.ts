import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalise } from './normalise.js';
import { TEST_LEXICON as LEX } from './test-lexicon.js';

function key(raw: string, opts?: Parameters<typeof normalise>[2]): string {
  const r = normalise(raw, LEX, opts);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value.canonicalKey;
}

describe('normalise — table-driven (real compositions)', () => {
  it('single molecule, form via hint', () => {
    expect(key('Paracetamol 650mg', { dosageFormHint: 'tablet' })).toBe('tablet|IR|1:650:mg:-');
  });

  it('single molecule, form in string', () => {
    expect(key('Paracetamol 650mg Tablet')).toBe('tablet|IR|1:650:mg:-');
  });

  it('resolves a synonym to the same molecule', () => {
    expect(key('Acetaminophen 650 mg tablet')).toBe(key('Paracetamol 650mg Tablet'));
  });

  it('FDC with salt + release, sorted by molecule id', () => {
    expect(key('Metformin HCl 500mg + Glimepiride 2mg SR Tablet')).toBe(
      'tablet|SR|2:500:mg:hydrochloride;3:2:mg:-',
    );
  });

  it('component order does not change the key (order invariance)', () => {
    expect(key('Glimepiride 2mg + Metformin HCl 500mg SR Tablet')).toBe(
      key('Metformin HCl 500mg + Glimepiride 2mg SR Tablet'),
    );
  });

  it('mcg is normalised to mg', () => {
    expect(key('Levothyroxine 100mcg Tablet')).toBe('tablet|IR|7:0.1:mg:-');
  });

  it('g is normalised to mg', () => {
    expect(key('Paracetamol 1g Tablet')).toBe('tablet|IR|1:1000:mg:-');
  });
});

describe('normalise — SAFETY: distinctions that must never collapse', () => {
  it('salt form: succinate ≠ tartrate', () => {
    const succ = key('Metoprolol Succinate 50mg Tablet');
    const tart = key('Metoprolol Tartrate 50mg Tablet');
    expect(succ).toBe('tablet|IR|4:50:mg:succinate');
    expect(tart).toBe('tablet|IR|4:50:mg:tartrate');
    expect(succ).not.toBe(tart);
  });

  it('release type: SR ≠ IR', () => {
    expect(key('Metoprolol Succinate 50mg SR Tablet')).not.toBe(
      key('Metoprolol Succinate 50mg Tablet'),
    );
  });

  it('strength: 500mg ≠ 50mg', () => {
    expect(key('Amlodipine 5mg Tablet')).not.toBe(key('Amlodipine 50mg Tablet'));
  });
});

describe('normalise — failure modes (fail closed, never partial)', () => {
  it('unresolved molecule fails', () => {
    const r = normalise('Unobtanium 50mg Tablet', LEX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNRESOLVED_MOLECULE');
  });

  it('a partly-unresolvable FDC fails entirely (no half-resolution)', () => {
    const r = normalise('Metformin 500mg + Unobtanium 2mg Tablet', LEX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNRESOLVED_MOLECULE');
  });

  it('missing strength fails', () => {
    const r = normalise('Paracetamol Tablet', LEX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NO_STRENGTH');
  });

  it('unknown dosage form fails (no guessing)', () => {
    const r = normalise('Paracetamol 650mg', LEX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNKNOWN_DOSAGE_FORM');
  });

  it('empty input fails', () => {
    const r = normalise('   ', LEX);
    expect(r.ok).toBe(false);
  });
});

describe('normalise — fuzzy fallback', () => {
  it('resolves a mild misspelling via trigram', () => {
    // 'metformine' → metformin
    const r = normalise('Metformine 500mg Tablet', LEX, { trigramThreshold: 0.7 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.components[0]!.molecule.innName).toBe('metformin');
  });
});

describe('normalise — properties (§4.1 testing)', () => {
  const molecules = [
    { name: 'paracetamol', id: 1 },
    { name: 'metformin', id: 2 },
    { name: 'glimepiride', id: 3 },
    { name: 'amlodipine', id: 5 },
    { name: 'telmisartan', id: 6 },
  ];
  const comp = fc.record({
    mol: fc.constantFrom(...molecules),
    strength: fc.integer({ min: 1, max: 999 }),
  });
  // 1..3 components with DISTINCT molecules
  const composition = fc
    .uniqueArray(comp, { minLength: 1, maxLength: 3, selector: (c) => c.mol.id })
    .map((cs) => ({
      cs,
      text: cs.map((c) => `${c.mol.name} ${c.strength}mg`).join(' + ') + ' Tablet',
    }));

  it('is deterministic', () => {
    fc.assert(
      fc.property(composition, ({ text }) => {
        expect(key(text)).toBe(key(text));
      }),
    );
  });

  it('is invariant to component order', () => {
    fc.assert(
      fc.property(composition, fc.integer(), ({ cs }, seed) => {
        const shuffled = [...cs].sort(
          (a, b) => ((a.mol.id * 31 + seed) % 7) - ((b.mol.id * 31 + seed) % 7),
        );
        const base = cs.map((c) => `${c.mol.name} ${c.strength}mg`).join(' + ') + ' Tablet';
        const perm = shuffled.map((c) => `${c.mol.name} ${c.strength}mg`).join(' + ') + ' Tablet';
        expect(key(perm)).toBe(key(base));
      }),
    );
  });

  it('drops no components', () => {
    fc.assert(
      fc.property(composition, ({ cs, text }) => {
        const r = normalise(text, LEX);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.components).toHaveLength(cs.length);
      }),
    );
  });
});
