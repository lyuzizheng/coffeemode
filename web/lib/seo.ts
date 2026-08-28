/**
 * SEO builders for the public /cafes/[id] surface (spec 0001 §Rendering —
 * DG105/DG108). Pure functions only: no I/O, no next-intl, so the metadata
 * contract is unit-testable. Locale-owned copy stays in messages files;
 * these builders supply the data that copy interpolates.
 */
import { r2PublicUrl } from "@/lib/images/constants";
import type { WorkStats } from "@/lib/stats/work-stats";
import type { WeeklyHours } from "@/lib/hours";
import type { CafeDetail } from "@/types/cafes";

/** Canonical cafe path — id-based, stable across renames (DG104). */
export function cafeCanonicalPath(id: string): string {
  return `/cafes/${id}`;
}

/**
 * Data for the og:description hook (DG108): the overall (Experience) score
 * only, plus the respondent count. Null when there is no experience score —
 * copy then uses the honest empty variant instead of a fake zero.
 */
export function ogHookParams(stats: WorkStats): { score: number; count: number } | null {
  if (stats.experience_score === null || stats.n_checkins === 0) return null;
  return { score: Math.round(stats.experience_score), count: stats.n_checkins };
}

/**
 * og:image source (absolute URL) per the artifact §4: the cafe cover when
 * one exists, otherwise the first gallery card; null means the dynamic
 * fallback card route must be used instead.
 */
export function cafeOgImageUrl(cafe: Pick<CafeDetail, "cover" | "gallery">): string | null {
  const key = cafe.cover ?? cafe.gallery[0]?.card ?? null;
  return key ? r2PublicUrl(key) : null;
}

/**
 * JSON-LD CafeOrCoffeeShop (DG105). aggregateRating comes from the
 * experience score with the check-in count; it is omitted entirely when
 * there is no score — schema.org forbids empty aggregate ratings.
 */
export function cafeJsonLd(
  cafe: Pick<CafeDetail, "name" | "address" | "city" | "lat" | "lng" | "work_stats">,
  url: string,
): Record<string, unknown> {
  const hook = ogHookParams(cafe.work_stats);
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CafeOrCoffeeShop",
    name: cafe.name,
    url,
    geo: {
      "@type": "GeoCoordinates",
      latitude: cafe.lat,
      longitude: cafe.lng,
    },
  };
  const addressParts = [cafe.address, cafe.city].filter((part): part is string => Boolean(part));
  if (addressParts.length > 0) {
    jsonLd.address = addressParts.join(", ");
  }
  if (hook) {
    jsonLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: hook.score,
      bestRating: 100,
      worstRating: 0,
      ratingCount: hook.count,
    };
  }
  return jsonLd;
}

/**
 * Serialize JSON-LD for injection via dangerouslySetInnerHTML.
 * Escapes `<` as `\u003c` so a stored cafe name like `x</script><script>alert(1)`
 * cannot break out of the `<script type="application/ld+json">` element on this
 * public, CDN-cached page. React's normal escaping is bypassed by
 * dangerouslySetInnerHTML, so the escaping must happen here.
 */
export function serializeJsonLd(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** The exact narrow slices the SSR shell hands to its client components. */
export interface PublicCafeShell {
  openState: { opening_hours: WeeklyHours | null; tz: string | null };
  actions: { name: string; lat: number; lng: number };
  gallery: { id: string; thumbnail: string }[];
}

/**
 * The single place that decides what the public SSR payload carries (DG13).
 * RSC serializes the runtime prop object, not the TypeScript shape — passing
 * a full `CafeDetail` to a client component would embed `StoredImage.by`,
 * provider ids, and full-size R2 keys in the served HTML. The shell composes
 * exclusively from these slices.
 */
export function publicCafeShell(cafe: CafeDetail): PublicCafeShell {
  return {
    openState: { opening_hours: cafe.opening_hours, tz: cafe.tz },
    actions: { name: cafe.name, lat: cafe.lat, lng: cafe.lng },
    gallery: (cafe.gallery ?? []).map((photo) => ({ id: photo.id, thumbnail: photo.thumbnail })),
  };
}
