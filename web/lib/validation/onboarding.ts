import "server-only";

/**
 * POST /api/onboarding/locate payload validation (spec 0009 §1: request
 * validation lives in `lib/validation/**`). The body is the granted
 * geolocation coordinate pair; anything outside the WGS84 ranges is rejected.
 */

type LocateBodyResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; error: string; status: number };

export function parseLocateBody(body: unknown): LocateBodyResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_body", status: 400 };
  }
  const { lat, lng } = body as { lat?: unknown; lng?: unknown };
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return { ok: false, error: "invalid_location", status: 400 };
  }
  return { ok: true, lat, lng };
}
