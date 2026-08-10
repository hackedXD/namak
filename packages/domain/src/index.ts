// @salt/domain — pure shared types. Zero I/O, zero dependencies.
// These mirror the SQL schema (§2.2) on the type side of the polyglot boundary.

/** Release profile. Part of the canonical formulation key — SR ≠ IR (§4.1 #3). */
export type ReleaseType = 'IR' | 'SR' | 'ER' | 'XR' | 'CR' | 'DR' | 'MR';

/** Strength unit after normalisation to a base (§4.1 step 3b). */
export type StrengthUnit = 'mg' | 'iu' | 'pct' | 'mg_per_ml';

export interface MoleculeRef {
  /** Stable molecule id (from the `molecule` table). */
  id: number;
  /** Lowercased INN, e.g. 'paracetamol'. */
  innName: string;
  /** Narrow-therapeutic-index flag — safety-critical (§4.3). */
  isNti?: boolean;
}

export interface CanonicalComponent {
  molecule: MoleculeRef;
  /** Strength in the base unit (mg / iu / pct value / mg per ml). */
  strengthBase: number;
  strengthUnit: StrengthUnit;
  /** Salt form, e.g. 'succinate'. NEVER dropped — succinate ≠ tartrate (§4.1 #2). */
  saltForm: string | null;
  /** Deterministic position after sorting by molecule id. */
  ordinal: number;
}

export interface CanonicalFormulation {
  /** The join key, e.g. 'tablet|IR|317:650:mg:-' (§4.1 step 7). */
  canonicalKey: string;
  dosageForm: string;
  releaseType: ReleaseType;
  route: string;
  isFdc: boolean;
  components: CanonicalComponent[]; // sorted by molecule.id ascending
}

/** A neutral Result type — normalisation and equivalence never throw for
 *  expected failures; a half-resolved formulation is a safety hazard (§4.1 #8). */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
