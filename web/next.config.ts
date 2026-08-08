import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSerwist } from "@serwist/turbopack";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // VPS + Docker standalone deploy (ADR-0001). Cloudflare/OpenNext is a
  // future alternative, not the primary target.
  output: "standalone",

  images: {
    // R2 images are served through the Cloudflare CDN domain once the
    // image-pipeline slice lands; allow the pattern now so it is not a
    // later config surprise.
    loader: "custom",
    loaderFile: "./lib/images/loader.ts",
    remotePatterns: [
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "images.coffeemode.app" },
    ],
  },

  async headers() {
    return [
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

export default withNextIntl(withSerwist(nextConfig));
