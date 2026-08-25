/** Great-circle distance (haversine) shared across services. */

export const EARTH_RADIUS_KM = 6371.0088;
export const EARTH_RADIUS_M = 6_371_008.8;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function haversineDistanceM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_M * c);
}

/** Approx km per degree of latitude (constant enough for bounding boxes). */
export function kmPerDegLat(): number {
  return 111.32;
}

export function kmPerDegLng(lat: number): number {
  const clamped = Math.max(-89.9999, Math.min(89.9999, lat));
  return 111.32 * Math.cos((clamped * Math.PI) / 180);
}

/** Normalize a longitude into [-180, 180) for antimeridian-spanning intervals. */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}
