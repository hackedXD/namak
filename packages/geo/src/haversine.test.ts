import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { haversineKm } from './haversine.js';
import { queryPrefixes, nearest } from './index.js';

const BENGALURU = { lat: 12.9716, lng: 77.5946 };
const CHENNAI = { lat: 13.0827, lng: 80.2707 };

describe('haversineKm', () => {
  it('matches a known city-to-city distance', () => {
    // Bengaluru → Chennai is ≈ 290 km great-circle.
    expect(haversineKm(BENGALURU, CHENNAI)).toBeGreaterThan(285);
    expect(haversineKm(BENGALURU, CHENNAI)).toBeLessThan(295);
  });

  it('is zero for identical points and symmetric', () => {
    expect(haversineKm(BENGALURU, BENGALURU)).toBe(0);
    fc.assert(
      fc.property(
        fc.double({ min: -85, max: 85, noNaN: true }),
        fc.double({ min: -175, max: 175, noNaN: true }),
        fc.double({ min: -85, max: 85, noNaN: true }),
        fc.double({ min: -175, max: 175, noNaN: true }),
        (la1, ln1, la2, ln2) => {
          const d1 = haversineKm({ lat: la1, lng: ln1 }, { lat: la2, lng: ln2 });
          const d2 = haversineKm({ lat: la2, lng: ln2 }, { lat: la1, lng: ln1 });
          expect(Math.abs(d1 - d2)).toBeLessThan(1e-9);
        },
      ),
    );
  });
});

describe('queryPrefixes', () => {
  it('includes the centre cell prefix and returns prefixes of the right length', () => {
    const prefixes = queryPrefixes(BENGALURU, 5);
    expect(prefixes).toContain('tdr1v'); // centre prefix at precision 5
    for (const p of prefixes) expect(p).toHaveLength(5);
    // centre + 8 neighbours, deduped: at most 9
    expect(prefixes.length).toBeLessThanOrEqual(9);
  });
});

describe('nearest', () => {
  it('sorts candidates by distance and respects the limit', () => {
    const candidates = [
      { id: 'far', lat: 19.076, lng: 72.8777 }, // Mumbai
      { id: 'near', lat: 12.97, lng: 77.59 }, // ~near Bengaluru
      { id: 'mid', lat: 13.0827, lng: 80.2707 }, // Chennai
    ];
    const top2 = nearest(BENGALURU, candidates, 2);
    expect(top2.map((c) => c.id)).toEqual(['near', 'mid']);
    expect(top2[0]!.distanceKm).toBeLessThan(top2[1]!.distanceKm);
  });
});
