// Price ladder engine (design §4.4). Pure given inputs.
//
// Key decisions from the design, implemented here:
//  - Rank by effectiveCost (the packs you must actually buy), NOT unit price — a
//    cheaper per-tablet price in a big pack is worse if you need only a few.
//  - No personalisation, ever: deterministic ordering with a stable final
//    tie-break (product id), so the ladder is byte-identical for every user.
//  - Blocked (NOT_INTERCHANGEABLE) candidates are separated out, never hidden.
//  - Provenance travels with every number.

import { assessEquivalence, type EquivalenceContext } from '@salt/equivalence';
import { computeOvercharge, legalMaxPerUnit } from './overcharge.js';
import type {
  CandidateProduct,
  Ladder,
  LadderInput,
  LadderRow,
  Provenance,
} from './types.js';
import type { CanonicalFormulation } from '@salt/domain';

const money = (n: number): number => Math.round(n * 100) / 100;

function priceRow(
  src: CanonicalFormulation,
  p: CandidateProduct,
  quantityNeeded: number,
  legalMax: number | null,
): LadderRow {
  const ctx: EquivalenceContext = {};
  if (p.hasActiveRecall === true) ctx.candidateHasActiveRecall = true;
  const equivalence = assessEquivalence(src, p.formulation, ctx);

  const unitPrice = money(p.mrp / p.packSize);
  const packsNeeded = Math.ceil(quantityNeeded / p.packSize);
  const effectiveCost = money(packsNeeded * p.mrp);
  const wastage = packsNeeded * p.packSize - quantityNeeded;
  const overCeiling = legalMax === null ? null : unitPrice > legalMax;

  return {
    product: p,
    equivalence,
    unitPrice,
    packsNeeded,
    effectiveCost,
    wastage,
    savingVsCostliest: 0, // filled once the section is known
    overCeiling,
    provenance: p.provenance,
  };
}

function makeCompare(channelTier: Record<string, number>) {
  const tier = (id: string) => channelTier[id] ?? Number.MAX_SAFE_INTEGER;
  return (a: LadderRow, b: LadderRow): number => {
    if (a.effectiveCost !== b.effectiveCost) return a.effectiveCost - b.effectiveCost;
    if (a.unitPrice !== b.unitPrice) return a.unitPrice - b.unitPrice;
    const ta = tier(a.product.channelId);
    const tb = tier(b.product.channelId);
    if (ta !== tb) return ta - tb;
    return a.product.productId - b.product.productId; // stable final tie-break
  };
}

function applySavings(section: LadderRow[]): void {
  if (section.length === 0) return;
  const costliest = section.reduce((m, r) => Math.max(m, r.effectiveCost), 0);
  for (const r of section) r.savingVsCostliest = money(costliest - r.effectiveCost);
}

function dedupeProvenance(rows: LadderRow[]): Provenance[] {
  const seen = new Set<string>();
  const out: Provenance[] = [];
  for (const r of rows) {
    const key = `${r.provenance.sourceId}|${r.provenance.snapshotDate}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r.provenance);
    }
  }
  return out;
}

export function buildLadder(input: LadderInput): Ladder {
  const legalMax = input.ceiling
    ? money(legalMaxPerUnit(input.ceiling.ceilingPerUnit, input.ceiling.gstPct))
    : null;

  const rows = input.candidates.map((p) =>
    priceRow(input.formulation, p, input.quantityNeeded, legalMax),
  );

  const cmp = makeCompare(input.channelTier);
  const ladder = rows.filter((r) => r.equivalence.verdict !== 'NOT_INTERCHANGEABLE').sort(cmp);
  const notInterchangeable = rows
    .filter((r) => r.equivalence.verdict === 'NOT_INTERCHANGEABLE')
    .sort(cmp);

  applySavings(ladder);
  applySavings(notInterchangeable);

  const topSaving =
    ladder.length > 0
      ? money(ladder[ladder.length - 1]!.effectiveCost - ladder[0]!.effectiveCost)
      : null;

  const overcharge =
    input.quotedUnitPrice !== undefined && legalMax !== null
      ? computeOvercharge(input.quotedUnitPrice, legalMax, input.quantityNeeded)
      : null;

  return {
    formulation: input.formulation,
    ladder,
    notInterchangeable,
    legalMaxPerUnit: legalMax,
    ceilingCitation: input.ceiling?.notificationNo ?? null,
    topSaving,
    overcharge,
    kendras: input.kendras ?? [],
    asOf: input.asOf ?? null,
    provenance: dedupeProvenance(rows),
  };
}
