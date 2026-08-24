import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import bundleAnalyzer from "@next/bundle-analyzer";
import { withSerwist } from "@serwist/turbopack";
import { R2_PUBLIC_HOST, assertR2PublicUrlMatches } from "./lib/images/constants";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

// Fail the build when the env drifted from the single-source constant (issue #40).
assertR2PublicUrlMatches(process.env.NEXT_PUBLIC_R2_PUBLIC_URL);

const nextConfig: NextConfig = {
  // VPS + Docker standalone deploy (ADR-0001). Cloudflare/OpenNext is a
  // future alternative, not the primary target.
  output: "standalone",

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
    ];
  },
};

export default withBundleAnalyzer(withNextIntl(withSerwist(nextConfig)));
