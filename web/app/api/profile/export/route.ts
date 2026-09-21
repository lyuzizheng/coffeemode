import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { getProfileExport } from "@/lib/db/profile";

/**
 * GET /api/profile/export (BRAWUKA-504): the "Download my data" bundle —
 * profile + every check-in (soft-deleted included) + created cafes +
 * navigations as one JSON download. Own bucket: an export is a full-table
 * read, not a profile-read.
 */
export const GET = apiRoute(
  { bucket: "profile-export", auth: "required", route: "GET /api/profile/export" },
  async (_request, ctx) => {
    const bundle = await getProfileExport(ctx.user.id);
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="cafemood-export-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  },
);
