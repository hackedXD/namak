// Builders for test formulations (real molecules; no fabricated clinical data).
import type {
  CanonicalComponent,
  CanonicalFormulation,
  MoleculeRef,
  ReleaseType,
  StrengthUnit,
} from '@salt/domain';

export function mol(id: number, innName: string, isNti = false): MoleculeRef {
  return { id, innName, isNti };
}

export function comp(
  molecule: MoleculeRef,
  strengthBase: number,
  opts: { unit?: StrengthUnit; salt?: string | null; ordinal?: number } = {},
): CanonicalComponent {
  return {
    molecule,
    strengthBase,
    strengthUnit: opts.unit ?? 'mg',
    saltForm: opts.salt ?? null,
    ordinal: opts.ordinal ?? 0,
  };
}

export function formulation(
  components: CanonicalComponent[],
  opts: { dosageForm?: string; releaseType?: ReleaseType; route?: string } = {},
): CanonicalFormulation {
  const dosageForm = opts.dosageForm ?? 'tablet';
  const releaseType = opts.releaseType ?? 'IR';
  const route = opts.route ?? 'oral';
  const sorted = [...components].sort((a, b) => a.molecule.id - b.molecule.id);
  const canonicalKey =
    `${dosageForm}|${releaseType}|` +
    sorted.map((c) => `${c.molecule.id}:${c.strengthBase}:${c.strengthUnit}:${c.saltForm ?? '-'}`).join(';');
  return { canonicalKey, dosageForm, releaseType, route, isFdc: sorted.length > 1, components: sorted };
}
