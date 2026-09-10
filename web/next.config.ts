import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSerwist } from "@serwist/turbopack";
// Config schema (not the server-only runtime module) — Next's config
// transpiler rejects the `server-only` guard (DG107 values, one source).
import { loadYaml, parseAppConfig } from "./lib/config-schema";
import { R2_PUBLIC_HOST, assertR2PublicUrlMatches } from "./lib/images/constants";
// Pure policy helpers (edge-safe, no node: imports) — the single source for
// the cafe-shell cache header value (BRAWUKA-184).
import { cafeShellCacheControl } from "./lib/cache-policy";

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
        // This static header only describes the cacheable case. The bypass
        // side (Set-Cookie responses, non-200 statuses incl. the
        // proxy-rewritten gone-cafe 404, Accept-Language cache keying) is
        // executable, not a comment: seo.shellCache in app.yaml owns the
        // values, lib/cache-policy.ts owns the predicates, proxy.ts stamps
        // no-store per response, and deploy/dokploy/cache-rules.json owns
        // the edge rule (BRAWUKA-184).
        source: "/cafes/:id*",
        headers: [
          {
            key: "Cache-Control",
            value: cafeShellCacheControl(appConfig.seo.shellCache),
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
      {
        // Baseline security headers on every response (BRAWUKA-167).
        // HSTS only in production: Traefik terminates TLS there; local dev
        // and non-TLS staging must never receive it.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default withNextIntl(withSerwist(nextConfig));
