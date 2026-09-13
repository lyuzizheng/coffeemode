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

interface CacheTuning {
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
 * Non-API routes without a rule fall through to serwist's defaultCache
 * (asset-type matchers — fine). API routes must NEVER do that: defaultCache
 * has a same-origin `/api/` catch-all cached NetworkFirst for 24h
 * ("apis"), and the Cache API ignores the server's `Cache-Control:
 * no-store` header — user-specific data would be served stale (issue #46).
 * The catch-all `api` rule below guards every API route, present and
 * future, so individual API rules are no longer enumerated here.
 */

/**
 * Service-worker cache tuning (BRAWUKA-250). These stay named module-level
 * constants rather than `app.yaml` values: the worker bundle cannot read
 * server config (or even `process.env` — see `lib/images/constants.ts`), so
 * config ownership is unreachable here. Eviction caps and TTLs for immutable
 * assets are internal mechanics, not product knobs.
 */
const R2_IMAGES_MAX_ENTRIES = 200;
const R2_IMAGES_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
const NEXT_STATIC_MAX_ENTRIES = 200;
const NEXT_STATIC_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year
const STATIC_ASSETS_MAX_ENTRIES = 100;
const STATIC_ASSETS_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year

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
  // Auth must always be fresh.
  {
    name: "auth",
    method: "GET",
    matcher: ({ url }) => url.pathname.startsWith("/auth/"),
    handler: "network-only",
  },
  // Every API route is user-specific or volatile. Without this, unmatched
  // /api/* GETs fall into defaultCache's 24h NetworkFirst "apis" cache.
  {
    name: "api",
    method: "GET",
    matcher: ({ url }) => url.pathname.startsWith("/api/"),
    handler: "network-only",
  },
  // R2 image variants are immutable once processed — cache first, no
  // revalidation round-trip. (Review 2026-08-09 F4: was NetworkFirst.)
  {
    name: "r2-images",
    method: "GET",
    matcher: ({ url }) => url.hostname === R2_PUBLIC_HOST,
    handler: "cache-first",
    cache: { cacheName: "r2-images", maxEntries: R2_IMAGES_MAX_ENTRIES, maxAgeSeconds: R2_IMAGES_MAX_AGE_SECONDS },
  },
  // Immutable build assets.
  {
    name: "next-static",
    method: "GET",
    matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
    handler: "cache-first",
    cache: {
      cacheName: "next-static-assets",
      maxEntries: NEXT_STATIC_MAX_ENTRIES,
      maxAgeSeconds: NEXT_STATIC_MAX_AGE_SECONDS,
    },
  },
  // Immutable app icons and fonts.
  {
    name: "static-assets",
    method: "GET",
    matcher: ({ url }) =>
      url.pathname.startsWith("/icons/") || url.pathname.startsWith("/fonts/"),
    handler: "cache-first",
    cache: { cacheName: "static-assets", maxEntries: STATIC_ASSETS_MAX_ENTRIES, maxAgeSeconds: STATIC_ASSETS_MAX_AGE_SECONDS },
  },
];
