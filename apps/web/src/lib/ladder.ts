// Client-side ladder compute for the prototype. Mirrors @salt/pricing (§4.4) —
// ranks by effectiveCost, ceiling comparison, overcharge — over DEMO data.
import {
  productsForFormulation, formulationById, ceilingByFormulation, moleculesOf,
  type Product,
} from './mock';

const CHANNEL_TIER: Record<string, number> = { jan_aushadhi: 1, unbranded: 2, branded: 3, epharmacy: 4 };
const money = (n: number) => Math.round(n * 100) / 100;

export type Verdict = 'INTERCHANGEABLE' | 'CONSULT_REQUIRED';

export interface Row {
  product: Product;
  unitPrice: number;
  packsNeeded: number;
  effectiveCost: number;
  wastage: number;
  savingVsCostliest: number;
  savingPct: number;
  overCeiling: boolean | null;
  verdict: Verdict;
}

export interface LadderView {
  formulationId: number;
  formulationLabel: string;
  isNti: boolean;
  rows: Row[];
  legalMaxPerUnit: number | null;
  ceilingCitation: string | null;
  ceilingDate: string | null;
  topSaving: number | null;
  topSavingPct: number | null;
  cheapest: Row | null;
  overcharge:
    | { quotedUnitPrice: number; legalMaxPerUnit: number; overByPerUnit: number; overByTotal: number; isOvercharge: boolean }
    | null;
  sourceIds: string[];
}

export function buildLadder(formulationId: number, quantity: number, quoted?: number): LadderView {
  const f = formulationById.get(formulationId)!;
  const isNti = moleculesOf(f).some((m) => m.isNti);
  const ceiling = ceilingByFormulation.get(formulationId) ?? null;
  const legalMax = ceiling ? money(ceiling.perUnit * (1 + ceiling.gstPct / 100)) : null;

  const rows: Row[] = productsForFormulation(formulationId).map((product) => {
    const unitPrice = money(product.mrp / product.packSize);
    const packsNeeded = Math.ceil(quantity / product.packSize);
    const effectiveCost = money(packsNeeded * product.mrp);
    return {
      product,
      unitPrice,
      packsNeeded,
      effectiveCost,
      wastage: packsNeeded * product.packSize - quantity,
      savingVsCostliest: 0,
      savingPct: 0,
      overCeiling: legalMax === null ? null : unitPrice > legalMax,
      verdict: isNti ? 'CONSULT_REQUIRED' : 'INTERCHANGEABLE',
    };
  });

  rows.sort((a, b) =>
    a.effectiveCost - b.effectiveCost ||
    a.unitPrice - b.unitPrice ||
    (CHANNEL_TIER[a.product.channel]! - CHANNEL_TIER[b.product.channel]!) ||
    a.product.id - b.product.id,
  );

  const costliest = rows.length ? Math.max(...rows.map((r) => r.effectiveCost)) : 0;
  for (const r of rows) {
    r.savingVsCostliest = money(costliest - r.effectiveCost);
    r.savingPct = costliest > 0 ? Math.round((r.savingVsCostliest / costliest) * 100) : 0;
  }

  const cheapest = rows[0] ?? null;
  const topSaving = rows.length ? money(costliest - rows[0]!.effectiveCost) : null;
  const topSavingPct = topSaving !== null && costliest > 0 ? Math.round((topSaving / costliest) * 100) : null;

  let overcharge: LadderView['overcharge'] = null;
  if (quoted !== undefined && legalMax !== null) {
    const overByPerUnit = money(quoted - legalMax);
    overcharge = {
      quotedUnitPrice: quoted,
      legalMaxPerUnit: legalMax,
      overByPerUnit,
      overByTotal: money(overByPerUnit * quantity),
      isOvercharge: overByPerUnit > 0,
    };
  }

  return {
    formulationId,
    formulationLabel: f.label,
    isNti,
    rows,
    legalMaxPerUnit: legalMax,
    ceilingCitation: ceiling?.notificationNo ?? null,
    ceilingDate: ceiling?.date ?? null,
    topSaving,
    topSavingPct,
    cheapest,
    overcharge,
    sourceIds: [...new Set(rows.map((r) => r.product.sourceId))],
  };
}
