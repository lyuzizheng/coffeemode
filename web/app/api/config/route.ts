import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { appConfig } from "@/lib/config";
import { getRuntimeConfig } from "@/lib/db/runtime-config";

/** Edge cache header from app.yaml (BRAWUKA-284): ≤60s freshness, cheap PoPs. */
function configCacheControl(): string {
  const cache = appConfig.runtimeConfig.responseCache;
  return `public, s-maxage=${cache.sMaxAgeSeconds}, stale-while-revalidate=${cache.staleWhileRevalidateSeconds}`;
}

/**
 * GET /api/config
 *
 * Operator-editable runtime content (BRAWUKA-284): announcement banners.
 * No redeploy needed; edge cache applies the TTL above.
 * Unauthenticated by design; values are public-safe only. Security /
 * rate-limit / auth parameters MUST NEVER be served here.
 *
 * Manifesto principle 3: banners are operational notices only (maintenance,
 * outage, feature, editorial) — no promos, no upsells, no induced sharing.
 * Each read touches the DB, so normal traffic doubles as Supabase keepalive.
 */
export const GET = apiRoute(
  { bucket: "runtime-config", route: "GET /api/config", ipOnly: true, user: null, silent: true },
  async () => {
    const config = await getRuntimeConfig();
    const response = NextResponse.json(config, { status: 200 });
    response.headers.set("Cache-Control", configCacheControl());
    return response;
  },
);
