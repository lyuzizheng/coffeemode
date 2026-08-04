import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // VPS + Docker standalone deploy (ADR-0001). Cloudflare/OpenNext is a
  // future alternative, not the primary target.
  output: "standalone",

  images: {
    // R2 images are served through the Cloudflare CDN domain once the
    // image-pipeline slice lands; allow the pattern now so it is not a
    // later config surprise.
    remotePatterns: [{ protocol: "https", hostname: "**.r2.cloudflarestorage.com" }],
  },
};

export default withNextIntl(nextConfig);
