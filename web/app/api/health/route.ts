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
