import { describe, it, expect } from 'vitest';
import { resolve, type Adjudicator, type ResolveOptions } from './resolve.js';
import { LEX, FORMULATIONS, mkFormulation } from './test-fixtures.js';

const base: ResolveOptions = { lexicon: LEX, formulations: FORMULATIONS };

describe('Tier 1 — deterministic', () => {
  it('exact canonical_key match, confidence 1.0', async () => {
    const r = await resolve({ rawComposition: 'Paracetamol 650mg Tablet' }, base);
    expect(r).toMatchObject({ formulationId: 1001, method: 'deterministic', confidence: 1 });
    expect(r.needsHumanReview).toBe(false);
  });

  it('resolves a synonym to the same formulation', async () => {
    const r = await resolve({ rawComposition: 'Acetaminophen 650 mg tablet' }, base);
    expect(r.formulationId).toBe(1001);
  });

  it('prior exact (manufacturer|brand|pack) short-circuits before parsing', async () => {
    const priorExact = new Map([['micro labs|dolo 650|15', 1001]]);
    const r = await resolve(
      { rawComposition: '???unparseable???', manufacturer: 'Micro Labs', brand: 'Dolo 650', pack: '15' },
      { ...base, priorExact },
    );
    expect(r).toMatchObject({ formulationId: 1001, method: 'deterministic' });
    expect(r.evidence).toMatchObject({ via: 'prior_exact' });
  });
});

describe('SAFETY — salt form is never crossed', () => {
  it('succinate maps to succinate, tartrate to tartrate', async () => {
    const s = await resolve({ rawComposition: 'Metoprolol Succinate 50mg Tablet' }, base);
    const t = await resolve({ rawComposition: 'Metoprolol Tartrate 50mg Tablet' }, base);
    expect(s.formulationId).toBe(1003);
    expect(t.formulationId).toBe(1004);
    expect(s.formulationId).not.toBe(t.formulationId);
  });

  it('never fuzzy-maps tartrate onto succinate when its own formulation is absent', async () => {
    const noTartrate = FORMULATIONS.filter((f) => f.id !== 1004);
    const r = await resolve({ rawComposition: 'Metoprolol Tartrate 50mg Tablet' }, {
      lexicon: LEX,
      formulations: noTartrate,
    });
    expect(r.formulationId).not.toBe(1003); // the succinate formulation
    expect(r.needsHumanReview).toBe(true);
  });
});

describe('SAFETY — strength is never approximated', () => {
  it('a near-but-different strength is NOT auto-mapped (goes to human review)', async () => {
    // table has amlodipine 5mg (F1005); product is 6mg and not in the table.
    const r = await resolve({ rawComposition: 'Amlodipine 6mg Tablet' }, base);
    expect(r.formulationId).toBeNull();
    expect(r.needsHumanReview).toBe(true);
  });
});

describe('Tier 2 — fuzzy structural match (robust to canonical_key drift)', () => {
  it('matches a formulation whose stored key is stale but fields are identical', async () => {
    // simulate a formulation persisted by an older normaliser: right fields,
    // different key string. Tier 1 (key match) misses; Tier 2 structural catches it.
    const amlo = mkFormulation(1005, 'Amlodipine 5mg Tablet');
    const legacy = { ...amlo, id: 2005, canonicalKey: 'LEGACY-AMLO-5' };
    const r = await resolve({ rawComposition: 'Amlodipine 5mg Tablet' }, {
      lexicon: LEX,
      formulations: [legacy],
    });
    expect(r).toMatchObject({ formulationId: 2005, method: 'fuzzy' });
    expect(r.confidence).toBeGreaterThanOrEqual(0.92);
  });
});

describe('Tier 3 — LLM adjudicator (constrained, never invents)', () => {
  // amlodipine besylate (salt present) vs the table's saltless amlodipine 5mg:
  // Tier 2 won't auto-accept (salt differs) → adjudicator decides.
  const product = { rawComposition: 'Amlodipine Besylate 5mg Tablet' };

  it('accepts a valid, confident choice', async () => {
    const adjudicator: Adjudicator = (req) => ({
      choiceId: req.candidates[0]!.formulationId,
      confidence: 0.95,
      reasoning: 'besylate is the salt of amlodipine',
    });
    const r = await resolve(product, { ...base, adjudicator });
    expect(r).toMatchObject({ formulationId: 1005, method: 'llm', confidence: 0.95 });
  });

  it('REJECTS an invented choice not in the candidate set', async () => {
    const adjudicator: Adjudicator = () => ({ choiceId: 99999, confidence: 0.99 });
    const r = await resolve(product, { ...base, adjudicator });
    expect(r.formulationId).toBeNull();
    expect(r.needsHumanReview).toBe(true);
    expect(r.evidence).toMatchObject({ via: 'llm_declined' });
  });

  it('rejects a low-confidence choice', async () => {
    const adjudicator: Adjudicator = (req) => ({
      choiceId: req.candidates[0]!.formulationId,
      confidence: 0.5,
    });
    const r = await resolve(product, { ...base, adjudicator });
    expect(r.needsHumanReview).toBe(true);
  });

  it('handles an explicit decline (choiceId null)', async () => {
    const adjudicator: Adjudicator = () => ({ choiceId: null, confidence: 0 });
    const r = await resolve(product, { ...base, adjudicator });
    expect(r.needsHumanReview).toBe(true);
  });

  it('without an adjudicator, falls through to human review', async () => {
    const r = await resolve(product, base);
    expect(r.needsHumanReview).toBe(true);
    expect(r.method).toBe('none');
  });
});

describe('normalise failure → human review (never guess)', () => {
  it('an unresolvable molecule is not mapped', async () => {
    const r = await resolve({ rawComposition: 'Unobtanium 50mg Tablet' }, base);
    expect(r).toMatchObject({ formulationId: null, method: 'none', needsHumanReview: true });
    expect(r.evidence).toMatchObject({ via: 'normalise_failed' });
  });
});

describe('audit evidence', () => {
  it('every result carries evidence for match_audit', async () => {
    const r = await resolve({ rawComposition: 'Paracetamol 650mg Tablet' }, base);
    expect(r.evidence).toBeTypeOf('object');
    expect(JSON.stringify(r.evidence)).toContain('tier');
  });
});
