import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encode, adjacent, neighbours } from './geohash.js';

describe('geohash encode — golden vectors', () => {
  it('matches the canonical reference vectors', () => {
    // Well-known geohash test vectors.
    expect(encode(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    expect(encode(42.6, -5.6, 5)).toBe('ezs42');
  });

  it('encodes real Indian cities to stable 7-char cells', () => {
    // Recorded from this implementation; regression guard.
    expect(encode(12.9716, 77.5946, 7)).toBe('tdr1v9q'); // Bengaluru
    expect(encode(28.6139, 77.209, 7)).toBe('ttnfucj'); // New Delhi
  });
});

describe('geohash encode — properties', () => {
  const lat = fc.double({ min: -89.9, max: 89.9, noNaN: true });
  const lng = fc.double({ min: -179.9, max: 179.9, noNaN: true });

  it('is deterministic', () => {
    fc.assert(
      fc.property(lat, lng, (a, b) => {
        expect(encode(a, b, 9)).toBe(encode(a, b, 9));
      }),
    );
  });

  it('shorter precision is a prefix of longer precision', () => {
    fc.assert(
      fc.property(lat, lng, (a, b) => {
        const short = encode(a, b, 4);
        const long = encode(a, b, 8);
        expect(long.startsWith(short)).toBe(true);
      }),
    );
  });

  it('produces exactly `precision` base32 chars', () => {
    fc.assert(
      fc.property(lat, lng, fc.integer({ min: 1, max: 12 }), (a, b, p) => {
        const h = encode(a, b, p);
        expect(h).toHaveLength(p);
        expect(/^[0-9bcdefghjkmnpqrstuvwxyz]+$/.test(h)).toBe(true);
      }),
    );
  });

  it('rejects out-of-range input', () => {
    expect(() => encode(91, 0)).toThrow();
    expect(() => encode(0, 181)).toThrow();
    expect(() => encode(NaN, 0)).toThrow();
  });
});

describe('geohash neighbours', () => {
  const lat = fc.double({ min: -80, max: 80, noNaN: true });
  const lng = fc.double({ min: -170, max: 170, noNaN: true });

  it('east then west returns the original cell', () => {
    fc.assert(
      fc.property(lat, lng, (a, b) => {
        const h = encode(a, b, 7);
        expect(adjacent(adjacent(h, 'e'), 'w')).toBe(h);
        expect(adjacent(adjacent(h, 'n'), 's')).toBe(h);
      }),
    );
  });

  it('returns the centre plus 8 distinct same-length neighbours', () => {
    fc.assert(
      fc.property(lat, lng, (a, b) => {
        const h = encode(a, b, 7);
        const cells = neighbours(h);
        expect(cells[0]).toBe(h); // centre first
        expect(cells).toHaveLength(9);
        expect(new Set(cells).size).toBe(9); // all distinct away from poles
        for (const c of cells) expect(c).toHaveLength(7);
      }),
    );
  });
});
