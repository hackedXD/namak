// The substitution rule registry (design §4.3). Each gate has a STABLE id so a
// verdict is auditable (EquivalenceResult.ruleIds) and maps to the curated
// `substitution_rule` table (which carries the named clinical reviewer + citation).

export type Verdict = 'INTERCHANGEABLE' | 'CONSULT_REQUIRED' | 'NOT_INTERCHANGEABLE';

export interface Rule {
  id: number;
  code: string;
  verdict: Verdict;
  displayMessage: string;
}

// Ordered by the gate sequence in assessEquivalence. Ids are stable — never renumber.
export const RULES = {
  EXACT_MATCH: {
    id: 0,
    code: 'EXACT_MATCH',
    verdict: 'INTERCHANGEABLE',
    displayMessage: 'Same medicine — same molecule, strength, form and release.',
  },
  MOLECULE_MISMATCH: {
    id: 1,
    code: 'MOLECULE_MISMATCH',
    verdict: 'NOT_INTERCHANGEABLE',
    displayMessage: 'Different active ingredients.',
  },
  STRENGTH_MISMATCH: {
    id: 2,
    code: 'STRENGTH_MISMATCH',
    verdict: 'NOT_INTERCHANGEABLE',
    displayMessage: 'Different strength.',
  },
  NTI_DRUG: {
    id: 3,
    code: 'NTI_DRUG',
    verdict: 'CONSULT_REQUIRED',
    displayMessage:
      'This medicine needs consistent blood levels. Ask your doctor before switching brands.',
  },
  RELEASE_MISMATCH: {
    id: 4,
    code: 'RELEASE_MISMATCH',
    verdict: 'NOT_INTERCHANGEABLE',
    displayMessage: 'Different release type (e.g. extended-release vs immediate).',
  },
  SALT_FORM_DIFFERS: {
    id: 5,
    code: 'SALT_FORM_DIFFERS',
    verdict: 'CONSULT_REQUIRED',
    displayMessage: 'Different salt form of the same molecule. Confirm with your doctor.',
  },
  ROUTE_MISMATCH: {
    id: 6,
    code: 'ROUTE_MISMATCH',
    verdict: 'NOT_INTERCHANGEABLE',
    displayMessage: 'Different route of administration.',
  },
  FORM_DIFFERS: {
    id: 7,
    code: 'FORM_DIFFERS',
    verdict: 'CONSULT_REQUIRED',
    displayMessage: 'Different dosage form. Confirm suitability with your pharmacist.',
  },
  ACTIVE_RECALL: {
    id: 8,
    code: 'ACTIVE_RECALL',
    verdict: 'NOT_INTERCHANGEABLE',
    displayMessage: 'This product has an active recall.',
  },
} as const satisfies Record<string, Rule>;

export type RuleKey = keyof typeof RULES;
