// The core story: brand → generic. Given a product the user searched, find the
// cheapest therapeutically-equivalent option (usually Jan Aushadhi) and the saving.
import { productBySlug, formulationById, type Product } from './mock';
import { buildLadder, type Row, type LadderView } from './ladder';

export interface Conversion {
  branded: Product;
  brandedRow: Row;
  generic: Row; // the cheapest equivalent
  isAlreadyCheapest: boolean;
  savingAbs: number; // for the given quantity
  savingPct: number;
  ladder: LadderView;
}

export function conversionForProduct(slug: string, quantity = 30): Conversion {
  const branded = productBySlug.get(slug)!;
  const ladder = buildLadder(branded.formulationId, quantity);
  const generic = ladder.rows[0]!;
  const brandedRow = ladder.rows.find((r) => r.product.id === branded.id) ?? generic;
  const savingAbs = Math.round((brandedRow.effectiveCost - generic.effectiveCost) * 100) / 100;
  const savingPct = brandedRow.effectiveCost > 0 ? Math.round((savingAbs / brandedRow.effectiveCost) * 100) : 0;
  return {
    branded,
    brandedRow,
    generic,
    isAlreadyCheapest: generic.product.id === branded.id,
    savingAbs,
    savingPct,
    ladder,
  };
}

export function conversionForFormulation(formulationId: number, quantity = 30) {
  const ladder = buildLadder(formulationId, quantity);
  const generic = ladder.rows[0]!;
  const branded = ladder.rows.find((r) => r.product.channel === 'branded') ?? ladder.rows[ladder.rows.length - 1]!;
  const savingAbs = Math.round((branded.effectiveCost - generic.effectiveCost) * 100) / 100;
  const savingPct = branded.effectiveCost > 0 ? Math.round((savingAbs / branded.effectiveCost) * 100) : 0;
  return { ladder, generic, branded, savingAbs, savingPct, formulation: formulationById.get(formulationId)! };
}
