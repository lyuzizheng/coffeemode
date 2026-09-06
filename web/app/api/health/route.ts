import { NextResponse } from "next/server";
import { BOOT_TIME, resolveAppVersion } from "@/lib/version";

/**
 * GET /api/health
 *
 * Lightweight health check used by the network-status hook, Traefik ingress,
 * Docker Compose, and Dokploy deployment convergence polling.
 * Must not touch slow dependencies.
 */
export function GET() {
  return NextResponse.json(
    {
      ok: true,
      version: resolveAppVersion(),
      boot_time: BOOT_TIME,
    },
    { status: 200 }
  );
}

/**
 * HEAD /api/health
 *
 * Cheap connectivity ping without response body.
 */
export function HEAD() {
  return new Response(null, { status: 200 });
}
