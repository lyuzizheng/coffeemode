/**
 * Service-worker runtime routing policy — single source of truth.
 *
 * `sw.ts` consumes these descriptors; `tests/sw.test.ts` table-tests them.
 * Keeping the descriptors plain (no serwist class imports) lets the test
 * suite exercise the matcher set without loading a worker library into jsdom.
 * (Review 2026-08-09 F4: dead/phantom rules, no coverage.)
 */

import { R2_PUBLIC_HOST } from "@/lib/images/constants";

/** Where the serwist worker lives. Shared by providers.tsx, sw.ts, and
 *  next.config.ts so the four-way duplication can't drift. */
export const SW_URL = "/serwist/sw.js";

export type CacheStrategy = "network-only" | "network-first" | "cache-first";

export interface CacheTuning {
  cacheName: string;
  maxEntries?: number;
  maxAgeSeconds?: number;
}

export interface SwRule {
  /** Stable label used in tests and cache diagnostics. */
  name: string;
  method: "GET";
  /** Returns true when the request matches this rule. */
  matcher: (ctx: { url: URL; request: Request }) => boolean;
  handler: CacheStrategy;
  /** Present only for network-first / cache-first rules. */
  cache?: CacheTuning;
}

/**
 * Routes that exist today (verified against `.next/types/routes.d.ts`):
 * `/`, `/theme-preview`, `/~offline`, and `/api/{health,images,places}`.
 * Rules for routes that do not exist yet are deliberately absent — dead
 * caching policy fails silently in production (review 2026-08-09 F4).
 */
export const RUNTIME_RULES: SwRule[] = [
  // The home page is dynamic (reads cookies); never cache it. The offline
  // fallback page handles navigation when the network is unavailable.
  {
    name: "home",
    method: "GET",
    matcher: ({ url }) => url.pathname === "/",
    handler: "network-only",
  },
  // Service worker and manifest must always be fresh.
  {
    name: "sw-manifest",
    method: "GET",
    matcher: ({ url }) =>
      url.pathname === SW_URL || url.pathname === "/manifest.webmanifest",
    handler: "network-only",
  },
  // Auth and uploads must always be fresh.
  {
    name: "auth",
    method: "GET",
    matcher: ({ url }) => url.pathname.startsWith("/auth/"),
    handler: "network-only",
  },
  {
    name: "images-api",
    method: "GET",
    matcher: ({ url }) => url.pathname.startsWith("/api/images/"),
    handler: "network-only",
  },
  // The health ping and POI proxy should not be double-cached.
  {
    name: "health-and-places",
    method: "GET",
    matcher: ({ url }) =>
      url.pathname.startsWith("/api/health") || url.pathname.startsWith("/api/places/"),
    handler: "network-only",
  },
  // R2 image variants are immutable once processed — cache first, no
  // revalidation round-trip. (Review 2026-08-09 F4: was NetworkFirst.)
  {
    name: "r2-images",
    method: "GET",
    matcher: ({ url }) => url.hostname === R2_PUBLIC_HOST,
    handler: "cache-first",
    cache: { cacheName: "r2-images", maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
  },
  // Immutable build assets.
  {
    name: "next-static",
    method: "GET",
    matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
    handler: "cache-first",
    cache: {
      cacheName: "next-static-assets",
      maxEntries: 200,
      maxAgeSeconds: 365 * 24 * 60 * 60,
    },
  },
  // Immutable app icons and fonts.
  {
    name: "static-assets",
    method: "GET",
    matcher: ({ url }) =>
      url.pathname.startsWith("/icons/") || url.pathname.startsWith("/fonts/"),
    handler: "cache-first",
    cache: { cacheName: "static-assets", maxEntries: 100, maxAgeSeconds: 365 * 24 * 60 * 60 },
  },
];
