import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSerwist } from "@serwist/turbopack";
// Config schema (not the server-only runtime module) — Next's config
// transpiler rejects the `server-only` guard (DG107 values, one source).
import { loadYaml, parseAppConfig } from "./lib/config-schema";
import { R2_PUBLIC_HOST, assertR2PublicUrlMatches } from "./lib/images/constants";

const appConfig = parseAppConfig(loadYaml("app.yaml"));

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Fail the build when the env drifted from the single-source constant (issue #40).
assertR2PublicUrlMatches(process.env.NEXT_PUBLIC_R2_PUBLIC_URL);

const nextConfig: NextConfig = {
  // VPS + Docker standalone deploy (ADR-0001). Cloudflare/OpenNext is a
  // future alternative, not the primary target.
  output: "standalone",

  env: {
    NEXT_PUBLIC_RECENT_SEARCHES_MAX: String(appConfig.profile.recentSearchesMax),
  },

  images: {
    // R2 images are served through our Cloudflare CDN host only. The raw
    // `r2.cloudflarestorage.com` endpoints are never rendered through
    // <Image> (presigned URLs are upload-only), so no wildcard (issue #40).
    loader: "custom",
    loaderFile: "./lib/images/loader.ts",
    remotePatterns: [{ protocol: "https", hostname: R2_PUBLIC_HOST }],
  },

  async headers() {
    return [
      {
        // Next.js build chunks are hashed and immutable.
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // PWA icons and fonts are versioned by filename and safe to cache forever.
        source: "/icons/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Service worker and manifest must never be cached by the browser/edge.
        source: "/serwist/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        // API responses are private and must not be cached by shared caches.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, must-revalidate" },
        ],
      },
      {
        // The SSR cafe shell is public content (DG105): a viral shared link
        // must not hit Postgres per open. TTLs live in web/config/app.yaml
        // (DG107) — s-maxage for the CDN, stale-while-revalidate so a stale
        // hit never blocks on revalidation.
        //
        // LOCALE CAVEAT (review P1-3): the shell is content-negotiated
        // (cookie/Accept-Language, DG110), but Next overwrites the `Vary`
        // header on App Router HTML responses with its internal
        // `rsc, next-router-*` set, so a configured `Vary: Accept-Language`
        // never ships. Without a shared cache today this is inert; when the
        // Cloudflare CDN lands (deploy-vps) its cache rule MUST vary on
        // Accept-Language (and Cookie once a locale switcher exists) or the
        // first locale to hit a URL would be served to everyone. Recorded in
        // docs/agent/current-state.md known issues; do not "fix" by removing
        // s-maxage (DG105 is spec-owned).
        //
        // COOKIE / 404 CAVEAT: this header also matches responses that just
        // refreshed a Supabase session (Set-Cookie present via proxy setAll)
        // and the proxy-rewritten gone-cafe 404s (/__gone-cafe). Inert with
        // no shared cache; before the CDN lands its Cache Rule MUST bypass on
        // `sb-*` request cookies and on Set-Cookie responses, otherwise a
        // refreshed session cookie is cached and a 404 can pin a URL for up
        // to s-maxage after the cafe is recreated. See docs/agent/current-state.md.
        source: "/cafes/:id*",
        headers: [
          {
            key: "Cache-Control",
            value: `public, s-maxage=${appConfig.seo.shellCache.sMaxAgeSeconds}, stale-while-revalidate=${appConfig.seo.shellCache.staleWhileRevalidateSeconds}`,
          },
        ],
      },
      {
        // Sitemap is the most bot-hit endpoint; without caching every crawl
        // scans the full cafes table (ORDER BY lastmod). A short s-maxage
        // bounds origin load (DG105/DG107); cache key is locale-independent.
        source: "/sitemap.xml",
        headers: [
          {
            key: "Cache-Control",
            value: `public, s-maxage=${appConfig.seo.shellCache.sMaxAgeSeconds}, stale-while-revalidate=${appConfig.seo.shellCache.staleWhileRevalidateSeconds}`,
          },
        ],
      },
    ];
  },
};

export default withNextIntl(withSerwist(nextConfig));
