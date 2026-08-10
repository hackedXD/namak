// Price ladder types (design §4.4). All inputs are passed in — the engine does
// no fetching, so a given (formulation, candidates, ceiling, quantity, pincode)
// produces a byte-identical ladder for every user (§4.4: no personalisation).

import type { CanonicalFormulation } from '@salt/domain';
import type { EquivalenceResult } from '@salt/equivalence';

/** Where each number came from — attached to every priced row (§5.2). */
export interface Provenance {
  sourceId: string;
  snapshotDate: string;
}

/** A candidate product (a brand on a formulation) with a current price. */
export interface CandidateProduct {
  productId: number;
  brandName: string;
  channelId: string; // 'jan_aushadhi' | 'unbranded' | 'branded' | 'epharmacy'
  manufacturer?: string;
  packSize: number; // e.g. 15 tablets, 100 ml
  packUnit: string;
  mrp: number; // pack price, INR
  formulation: CanonicalFormulation; // the candidate's own formulation (for equivalence)
  hasActiveRecall?: boolean;
  provenance: Provenance;
}

export interface CeilingInput {
  ceilingPerUnit: number; // excl. GST, per DPCO
  gstPct: number;
  notificationNo: string;
  notificationDate: string;
}

/** Opaque pass-through: kendras are found by the geo/db layer and attached here. */
export interface Kendra {
  externalId: string;
  name: string;
  pincode: string;
  distanceKm?: number;
  stockDisclaimer: 'catalogue_only';
}

export interface LadderInput {
  formulation: CanonicalFormulation; // the source formulation the ladder is for
  candidates: readonly CandidateProduct[];
  ceiling: CeilingInput | null;
  quantityNeeded: number;
  /** What the user says they were charged, PER UNIT, for the overcharge check. */
  quotedUnitPrice?: number;
  /** Ranking prior per channel (1 = cheapest expected). Missing → ranked last. */
  channelTier: Record<string, number>;
  kendras?: readonly Kendra[];
  asOf?: string;
}

export interface LadderRow {
  product: CandidateProduct;
  equivalence: EquivalenceResult;
  unitPrice: number; // mrp / packSize
  packsNeeded: number; // ceil(quantity / packSize)
  effectiveCost: number; // packsNeeded * mrp — what you actually pay
  wastage: number; // extra units bought beyond what's needed
  /** Saving vs the costliest option in the same ladder section. */
  savingVsCostliest: number;
  /** True when this product's per-unit price is above the legal maximum. */
  overCeiling: boolean | null;
  provenance: Provenance;
}

export interface Overcharge {
  quotedUnitPrice: number;
  legalMaxPerUnit: number;
  overByPerUnit: number; // >0 means charged above the legal max
  overByTotal: number; // overByPerUnit * quantityNeeded
  isOvercharge: boolean;
}

export interface Ladder {
  formulation: CanonicalFormulation;
  /** Interchangeable + consult-required candidates, cheapest first. */
  ladder: LadderRow[];
  /** Blocked candidates — shown separately, never hidden (§4.4). */
  notInterchangeable: LadderRow[];
  legalMaxPerUnit: number | null;
  ceilingCitation: string | null;
  topSaving: number | null; // costliest − cheapest across the main ladder
  overcharge: Overcharge | null;
  kendras: readonly Kendra[];
  asOf: string | null;
  provenance: Provenance[];
}
