// Geohash encode + neighbour computation (design §4.5).
// Pure, deterministic, zero I/O. Standard base-32 geohash (Gustavo Niemeyer's
// scheme); the neighbour tables are the well-known adjacency/border tables.
//
// Used two ways in Salt:
//   - ingestion computes outlet.geohash7 for every kendra;
//   - serving computes the query prefix from a pincode centroid and expands to
//     the centre cell plus its 8 neighbours (§4.5) to avoid boundary misses.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'; // note: no a, i, l, o

export type Direction = 'n' | 's' | 'e' | 'w';

/** Encode a lat/lng to a geohash of the given precision (default 7 ≈ 153 m cell). */
export function encode(lat: number, lng: number, precision = 7): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new RangeError('encode: lat/lng must be finite numbers');
  }
  if (lat < -90 || lat > 90) throw new RangeError('encode: lat out of range');
  if (lng < -180 || lng > 180) throw new RangeError('encode: lng out of range');
  if (precision < 1) throw new RangeError('encode: precision must be >= 1');

  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = '';

  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  while (geohash.length < precision) {
    if (evenBit) {
      // bisect longitude
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        idx = idx * 2 + 1;
        lngMin = mid;
      } else {
        idx = idx * 2;
        lngMax = mid;
      }
    } else {
      // bisect latitude
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        idx = idx * 2 + 1;
        latMin = mid;
      } else {
        idx = idx * 2;
        latMax = mid;
      }
    }
    evenBit = !evenBit;

    if (++bit === 5) {
      geohash += BASE32.charAt(idx);
      bit = 0;
      idx = 0;
    }
  }
  return geohash;
}

const NEIGHBOUR: Record<Direction, [string, string]> = {
  n: ['p0r21436x8zb9dcf5h7kjnmqesgutwvy', 'bc01fg45238967deuvhjyznpkmstqrwx'],
  s: ['14365h7k9dcfesgujnmqp0r2twvyx8zb', '238967debc01fg45kmstqrwxuvhjyznp'],
  e: ['bc01fg45238967deuvhjyznpkmstqrwx', 'p0r21436x8zb9dcf5h7kjnmqesgutwvy'],
  w: ['238967debc01fg45kmstqrwxuvhjyznp', '14365h7k9dcfesgujnmqp0r2twvyx8zb'],
};
const BORDER: Record<Direction, [string, string]> = {
  n: ['prxz', 'bcfguvyz'],
  s: ['028b', '0145hjnp'],
  e: ['bcfguvyz', 'prxz'],
  w: ['0145hjnp', '028b'],
};

/** The adjacent geohash cell (same precision) in a cardinal direction. */
export function adjacent(geohash: string, direction: Direction): string {
  const hash = geohash.toLowerCase();
  if (hash.length === 0) throw new Error('adjacent: empty geohash');
  const lastCh = hash.charAt(hash.length - 1);
  let parent = hash.slice(0, -1);

  const type: 0 | 1 = (hash.length % 2) as 0 | 1; // 0 = even length
  // if the last char is on the border for this direction, the parent changes
  if (BORDER[direction][type].indexOf(lastCh) !== -1 && parent !== '') {
    parent = adjacent(parent, direction);
  }
  return parent + BASE32.charAt(NEIGHBOUR[direction][type].indexOf(lastCh));
}

/** The centre cell plus its 8 neighbours — the set to query so a point near a
 *  cell boundary is never missed (§4.5). Order is stable. */
export function neighbours(geohash: string): string[] {
  const n = adjacent(geohash, 'n');
  const s = adjacent(geohash, 's');
  return [
    geohash,
    n,
    s,
    adjacent(geohash, 'e'),
    adjacent(geohash, 'w'),
    adjacent(n, 'e'),
    adjacent(n, 'w'),
    adjacent(s, 'e'),
    adjacent(s, 'w'),
  ];
}
