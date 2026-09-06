import { NextResponse } from "next/server";
import { BOOT_TIME, resolveAppVersion } from "@/lib/version";

/**
 * GET /api/health/version
 *
 * Dedicated version marker endpoint for deployment convergence polling.
 * Inherits public/no-auth exclusion via the `/api/health(?:/.*)?` proxy matcher.
 */
export function GET() {
  return NextResponse.json(
    {
      version: resolveAppVersion(),
      boot_time: BOOT_TIME,
    },
    { status: 200 }
  );
}
