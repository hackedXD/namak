// A small lexicon of REAL drug facts for tests (real INNs, real synonyms, real
// salt forms). Not fabricated data. The production lexicon will be built from the
// git-versioned data/*.yaml curated artifacts (with clinical review); this is a
// faithful subset used to exercise the pure engine.
import { buildLexicon } from './lexicon.js';

export const TEST_LEXICON = buildLexicon({
  molecules: [
    { id: 1, innName: 'paracetamol', synonyms: ['acetaminophen'] },
    { id: 2, innName: 'metformin' },
    { id: 3, innName: 'glimepiride' },
    { id: 4, innName: 'metoprolol' },
    { id: 5, innName: 'amlodipine' },
    { id: 6, innName: 'telmisartan' },
    { id: 7, innName: 'levothyroxine', isNti: true },
  ],
  saltForms: {
    hcl: 'hydrochloride',
    hydrochloride: 'hydrochloride',
    succinate: 'succinate',
    tartrate: 'tartrate',
    sodium: 'sodium',
    maleate: 'maleate',
    besylate: 'besylate',
  },
  dosageForms: {
    tablet: { form: 'tablet', route: 'oral' },
    tab: { form: 'tablet', route: 'oral' },
    capsule: { form: 'capsule', route: 'oral' },
    cap: { form: 'capsule', route: 'oral' },
    syrup: { form: 'syrup', route: 'oral' },
    injection: { form: 'injection', route: 'parenteral' },
    inj: { form: 'injection', route: 'parenteral' },
  },
  releaseModifiers: {
    sr: 'SR',
    xr: 'XR',
    er: 'ER',
    cr: 'CR',
    dr: 'DR',
    mr: 'MR',
    xl: 'XR',
    retard: 'SR',
  },
});
