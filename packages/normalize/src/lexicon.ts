// The Lexicon is the curated knowledge the normaliser needs, INJECTED so the
// engine stays pure (zero I/O). In production the caller builds it from the
// git-versioned data/ files (molecule_synonyms.yaml, dosage_forms.yaml, …) plus
// the `molecule` table; tests build small lexicons from real drug facts.

import type { MoleculeRef, ReleaseType } from '@salt/domain';

export interface Lexicon {
  /** lowercased synonym → molecule (e.g. 'acetaminophen' → paracetamol). */
  synonyms: ReadonlyMap<string, MoleculeRef>;
  /** salt token → canonical salt name (e.g. 'hcl' → 'hydrochloride'). */
  saltForms: ReadonlyMap<string, string>;
  /** dosage-form token → canonical form + route (e.g. 'tab' → tablet/oral). */
  dosageForms: ReadonlyMap<string, { form: string; route: string }>;
  /** release-modifier token → release type (e.g. 'sr' → 'SR'). */
  releaseModifiers: ReadonlyMap<string, ReleaseType>;
}

/** Convenience builder from plain objects/arrays (what YAML deserialises to). */
export function buildLexicon(input: {
  molecules: Array<{ id: number; innName: string; isNti?: boolean; synonyms?: string[] }>;
  saltForms: Record<string, string>;
  dosageForms: Record<string, { form: string; route: string }>;
  releaseModifiers: Record<string, ReleaseType>;
}): Lexicon {
  const synonyms = new Map<string, MoleculeRef>();
  for (const m of input.molecules) {
    const ref: MoleculeRef = { id: m.id, innName: m.innName, isNti: m.isNti ?? false };
    synonyms.set(m.innName.toLowerCase(), ref);
    for (const s of m.synonyms ?? []) synonyms.set(s.toLowerCase(), ref);
  }
  return {
    synonyms,
    saltForms: new Map(Object.entries(input.saltForms).map(([k, v]) => [k.toLowerCase(), v])),
    dosageForms: new Map(Object.entries(input.dosageForms).map(([k, v]) => [k.toLowerCase(), v])),
    releaseModifiers: new Map(
      Object.entries(input.releaseModifiers).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  };
}
