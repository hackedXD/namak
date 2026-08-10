// Test fixtures: a small lexicon + formulation table built from REAL drug facts
// by running the real normaliser. Not fabricated data.
import type { FormulationRecord } from '@salt/domain';
import { buildLexicon, normalise, type Lexicon } from '@salt/normalize';

export const LEX: Lexicon = buildLexicon({
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
    besylate: 'besylate',
    sodium: 'sodium',
  },
  dosageForms: {
    tablet: { form: 'tablet', route: 'oral' },
    tab: { form: 'tablet', route: 'oral' },
    capsule: { form: 'capsule', route: 'oral' },
  },
  releaseModifiers: { sr: 'SR', xr: 'XR', er: 'ER', cr: 'CR', dr: 'DR', mr: 'MR' },
});

export function mkFormulation(id: number, raw: string): FormulationRecord {
  const r = normalise(raw, LEX, { dosageFormHint: 'tablet' });
  if (!r.ok) throw new Error(`fixture normalise failed for "${raw}": ${r.error.code}`);
  return { id, ...r.value };
}

export const FORMULATIONS: FormulationRecord[] = [
  mkFormulation(1001, 'Paracetamol 650mg Tablet'),
  mkFormulation(1002, 'Metformin HCl 500mg + Glimepiride 2mg Tablet'),
  mkFormulation(1003, 'Metoprolol Succinate 50mg Tablet'),
  mkFormulation(1004, 'Metoprolol Tartrate 50mg Tablet'),
  mkFormulation(1005, 'Amlodipine 5mg Tablet'),
  mkFormulation(1006, 'Telmisartan 40mg Tablet'),
  mkFormulation(1007, 'Telmisartan 40mg + Amlodipine 5mg Tablet'),
];
