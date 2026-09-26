import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { BOOT_TIME, resolveAppVersion } from "@/lib/version";

/**
 * GET /api/health
 *
 * Lightweight liveness probe for the network-status hook, Traefik ingress,
 * Docker Compose, and Dokploy deployment convergence polling. Stays public
 * (no auth): infra probes carry no credentials, so a login gate would break
 * them. Rate-limited instead (BRAWUKA-639): the `health` bucket
 * (120/min, `web/config/rate-limits.yaml`) bounds per-IP flood on the
 * Cloudflare path. Edge-less callers (`anon:unknown` — Traefik and Docker
 * healthchecks over container-internal traffic) bypass the bucket via
 * `bypassUnknownClients`: their only legitimate consumers are internal
 * probes, and sharing the bucket with direct-origin flooders would turn LB
 * health into a kill switch (P1 review). Touches no slow dependencies — the
 * wrapper's auth lookup is skipped (`user: null`) and only the in-memory
 * token check runs on the Cloudflare path. (`ipOnly` intentionally absent:
 * `user: null` already forces the anonymous identity.)
 */
export const GET = apiRoute(
  { bucket: "health", route: "GET /api/health", user: null, bypassUnknownClients: true, silent: true },
  async () =>
    NextResponse.json(
      {
        ok: true,
        version: resolveAppVersion(),
        boot_time: BOOT_TIME,
      },
      { status: 200 },
    ),
);

/**
 * HEAD /api/health
 *
 * Cheap connectivity ping without response body. Same options as GET: the
 * Cloudflare-pathed allowance is shared, edge-less probes bypass.
 */
export const HEAD = apiRoute(
  { bucket: "health", route: "HEAD /api/health", user: null, bypassUnknownClients: true, silent: true },
  async () => new Response(null, { status: 200 }),
);
