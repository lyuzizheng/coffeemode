import type { MetadataRoute } from "next";
import { getRequestOrigin } from "@/lib/site-origin";

// Request-time origin: never prerendered at build.
export const dynamic = "force-dynamic";

/**
 * robots.txt (DG105): cafe pages are the public surface — allow them; keep
 * API handlers and internal playgrounds out of crawlers.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await getRequestOrigin();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/cafes/*"],
        disallow: ["/api/", "/theme-preview"],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
