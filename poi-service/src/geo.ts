/** Great-circle distance (haversine), km. */

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Approx km per degree of latitude (constant enough for bounding boxes). */
export function kmPerDegLat(): number {
  return 111.32;
}

export function kmPerDegLng(lat: number): number {
  return 111.32 * Math.cos((lat * Math.PI) / 180);
}