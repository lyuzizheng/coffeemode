// Moved hook to src/hooks/googleMaps/useResolvePlace.ts

// Try to extract a plausible title from a Google Maps URL.
export const extractPlaceTitleFromUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    const qp = u.searchParams.get("q") || u.searchParams.get("query");
    if (qp) return decodeURIComponent(qp);

    const placeMatch = u.pathname.match(/\/maps\/place\/(.+?)(?:\/|$)/i);
    if (placeMatch?.[1]) return decodeURIComponent(placeMatch[1].replace(/\+/g, " "));

    return null;
  } catch {
    return null;
  }
};