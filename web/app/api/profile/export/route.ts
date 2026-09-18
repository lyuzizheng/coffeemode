import { logError } from "@/lib/observability/server-log";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api/response";
import { getProfileExport } from "@/lib/db/profile";
import { guard } from "@/lib/api/guard";

/**
 * GET /api/profile/export (BRAWUKA-504): the "Download my data" bundle —
 * profile + every check-in (soft-deleted included) + created cafes +
 * navigations as one JSON download. Own bucket: an export is a full-table
 * read, not a profile-read.
 */
export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    bucket: "profile-export",
    requireAuth: true,
    route: "GET /api/profile/export",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const bundle = await getProfileExport(user.id);
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="cafemood-export-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logError({ route: gate.route, request, error, status: 500 });
    return apiError("internal_error", 500);
  }
}
