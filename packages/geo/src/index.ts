// @salt/geo — pure geo primitives (design §4.5). Zero I/O.
export { encode, adjacent, neighbours, type Direction } from './geohash.js';
export { haversineKm, type LatLng } from './haversine.js';

import { encode, neighbours } from './geohash.js';
import { haversineKm, type LatLng } from './haversine.js';

/**
 * The set of geohash prefixes to scan for outlets near a point, at a given
 * precision (§4.5). Returns the centre cell + its 8 neighbours, truncated to
 * `precision`, deduplicated. A SQL query then does `geohash7 LIKE prefix || '%'`
 * for each, and the small candidate set is refined with haversineKm.
 */
export function queryPrefixes(centre: LatLng, precision: number): string[] {
  const full = encode(centre.lat, centre.lng, Math.max(precision, 1));
  const cells = neighbours(full);
  const seen = new Set<string>();
  for (const c of cells) seen.add(c.slice(0, precision));
  return [...seen];
}

/** Rank candidate outlets by distance from a centre, nearest first, top N. */
export function nearest<T extends LatLng>(
  centre: LatLng,
  candidates: readonly T[],
  limit: number,
): Array<T & { distanceKm: number }> {
  return candidates
    .map((c) => ({ ...c, distanceKm: haversineKm(centre, c) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}
