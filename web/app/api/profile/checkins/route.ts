import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { getUserCheckIns } from "@/lib/db/profile";
import { appConfig } from "@/lib/config";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawLimit = searchParams.get("limit");
  let limit = appConfig.feed.pageSize;
  if (rawLimit !== null) {
    const parsed = parseInt(rawLimit, 10);
    if (Number.isNaN(parsed) || parsed <= 0 || !Number.isInteger(Number(rawLimit))) {
      return NextResponse.json({ error: "invalid_limit" }, { status: 400 });
    }
    limit = Math.min(50, parsed);
  }

  const cursor = searchParams.get("cursor") ?? undefined;

  try {
    const result = await getUserCheckIns(user.id, { limit, cursor });
    return NextResponse.json({
      items: result.items,
      next_cursor: result.nextCursor,
    });
  } catch (error) {
    console.error("GET /api/profile/checkins failed:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
