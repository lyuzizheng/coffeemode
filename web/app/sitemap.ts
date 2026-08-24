import type { MetadataRoute } from "next";
import { listCafeSitemapEntries } from "@/lib/db/cafes";
import { cafeCanonicalPath } from "@/lib/seo";
import { getRequestOrigin } from "@/lib/site-origin";

// DB-backed: never prerendered at build (CI builds without Postgres).
// Cached at the edge via next.config.ts /sitemap.xml s-maxage (DG105).
export const dynamic = "force-dynamic";

/**
 * Dynamic sitemap (DG105): every live cafe at its permanent canonical URL
 * (DG104/DG110). lastmod comes from work_stats — the aggregate is what
 * actually changes when check-ins land.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await getRequestOrigin();
  const entries = await listCafeSitemapEntries();
  return [
    { url: origin, changeFrequency: "daily", priority: 1 },
    ...entries.map((entry) => ({
      url: `${origin}${cafeCanonicalPath(entry.id)}`,
      lastModified: new Date(entry.lastmod),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
