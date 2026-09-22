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
 * (120/min, `web/config/rate-limits.yaml`) bounds anonymous flood while the
 * shared `anon:unknown` key still covers edge-less internal traffic. Touches
 * no slow dependencies — the wrapper's auth lookup is skipped (`user: null`)
 * and only the in-memory token check runs.
 */
export const GET = apiRoute(
  { bucket: "health", route: "GET /api/health", ipOnly: true, user: null },
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
 * Cheap connectivity ping without response body. Same bucket and identity as
 * GET so both verbs share one flood allowance.
 */
export const HEAD = apiRoute(
  { bucket: "health", route: "HEAD /api/health", ipOnly: true, user: null },
  async () => new Response(null, { status: 200 }),
);
