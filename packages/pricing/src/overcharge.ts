// Overcharge check (design Workflow D, §0.3 / §4.4). Compare what the user was
// quoted (per unit) against the legal maximum = ceiling per unit × (1 + GST).
import type { Overcharge } from './types.js';

export function legalMaxPerUnit(ceilingPerUnit: number, gstPct: number): number {
  return ceilingPerUnit * (1 + gstPct / 100);
}

export function computeOvercharge(
  quotedUnitPrice: number,
  legalMax: number,
  quantityNeeded: number,
): Overcharge {
  // round to paise to avoid float noise in a money value
  const overByPerUnit = Math.round((quotedUnitPrice - legalMax) * 100) / 100;
  const overByTotal = Math.round(overByPerUnit * quantityNeeded * 100) / 100;
  return {
    quotedUnitPrice,
    legalMaxPerUnit: legalMax,
    overByPerUnit,
    overByTotal,
    isOvercharge: overByPerUnit > 0,
  };
}
