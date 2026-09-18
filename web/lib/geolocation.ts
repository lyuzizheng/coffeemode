/**
 * Browser geolocation wrapper (spec 0001 §Location permission contract,
 * DG112): the OS prompt fires only behind an explicit tap — the welcome
 * card's enable button and the persistent locate button are the only
 * callers. Failures are normal states, never thrown errors.
 */

type GeoFailure = "denied" | "unavailable" | "unsupported";

export type GeoResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; reason: GeoFailure };

/** True when the Permissions API already reports a geolocation denial —
 * the browser will not re-prompt, so callers show the settings path (DG117)
 * instead of firing a dead getCurrentPosition. */
export async function isGeolocationDenied(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return false;
  }
  try {
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    });
    return status.state === "denied";
  } catch {
    return false;
  }
}

export function requestPosition(timeoutMs: number): Promise<GeoResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: "unsupported" });
  }
  const { promise, resolve } = Promise.withResolvers<GeoResult>();
  navigator.geolocation.getCurrentPosition(
    (position) =>
      resolve({
        ok: true,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }),
    (error) =>
      resolve({
        ok: false,
        reason: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
      }),
    { timeout: timeoutMs, maximumAge: 60_000 },
  );
  return promise;
}
