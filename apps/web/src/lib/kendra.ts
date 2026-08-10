import { kendras, type Kendra } from './mock';

// Demo pincode centroids (a handful of real-ish coordinates) so the proximity
// search computes a real haversine distance for the sample pincodes.
const CENTROIDS: Record<string, [number, number]> = {
  '560034': [12.9345, 77.6266],
  '560102': [12.9116, 77.6412],
  '560001': [12.9767, 77.5713],
  '110001': [28.6329, 77.2195],
  '400001': [18.9346, 72.8352],
  '600002': [13.0604, 80.2626],
};

const R = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
function haversineKm(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface NearbyKendra extends Kendra { distanceKm: number }

export function findNearbyKendras(pincode: string, limit = 5): { centroidKnown: boolean; results: NearbyKendra[] } {
  const centroid = CENTROIDS[pincode];
  if (!centroid) return { centroidKnown: false, results: [] };
  const results = kendras
    .map((k) => ({ ...k, distanceKm: Math.round(haversineKm(centroid, [k.lat, k.lng]) * 10) / 10 }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
  return { centroidKnown: true, results };
}

export const demoPincodes = Object.keys(CENTROIDS);
