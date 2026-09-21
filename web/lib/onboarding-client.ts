/**
 * Client call for POST /api/onboarding/locate (DG121): resolves a granted
 * geolocation to the current city server-side. Returns the resolved city or
 * null on any failure — offline grants still dismiss the card (DG123), so
 * callers treat null as "resolve later", never as an error surface.
 */
import { apiFetch } from "@/lib/http";

/**
 * Client view of the located city (BRAWUKA-503: merge with server
 * `ResolvedCity` evaluated and rejected — the server shape carries `tz` for
 * runtime-city creation while this client shape never needs it, and sharing
 * the server type would pull `server-only` across the client boundary).
 */
interface ResolvedLocateCity {
  id: string;
  name: string;
  nameZh: string;
  center: { lat: number; lng: number };
  runtime: boolean;
}

export async function postLocate(
  lat: number,
  lng: number,
): Promise<ResolvedLocateCity | null> {
  try {
    const body = await apiFetch<{ city: ResolvedLocateCity | null }>(
      "/api/onboarding/locate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      },
    );
    return body?.city ?? null;
  } catch {
    return null;
  }
}
