import { NextResponse } from "next/server";

/**
 * GET /api/health
 *
 * Lightweight health check used by the network-status hook to determine
 * real internet connectivity. Must not touch slow dependencies.
 */
export function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * HEAD /api/health
 *
 * Cheap connectivity ping without response body.
 */
export function HEAD() {
  return new Response(null, { status: 200 });
}
