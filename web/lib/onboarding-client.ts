/**
 * Client call for POST /api/onboarding/locate (DG121): resolves a granted
 * geolocation to the current city server-side. Returns the resolved city or
 * null on any failure — offline grants still dismiss the card (DG123), so
 * callers treat null as "resolve later", never as an error surface.
 */

export interface ResolvedLocateCity {
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
    const res = await fetch("/api/onboarding/locate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { city: ResolvedLocateCity | null };
    return body.city;
  } catch {
    return null;
  }
}
