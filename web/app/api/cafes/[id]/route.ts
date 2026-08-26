import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  cafeExists,
  getCafe,
  softDeleteCafe,
  toPublicCafeDetail,
} from "@/lib/db/cafes";
import {
  CAFES_READ_RATE_LIMIT,
  CAFES_WRITE_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
import { isValidUUID } from "@shared/uuid";

/**
 * GET /api/cafes/[id]
 * Single cafe detail. Anonymous read, rate limited; 404 when missing.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: "invalid_request", message: "id must be a UUID" },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  const clientId = getClientIdentifier(request, user);
  const rate = await rateLimiter.check(
    `cafes-read:${clientId}`,
    CAFES_READ_RATE_LIMIT.windowMs,
    CAFES_READ_RATE_LIMIT.maxRequests,
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const cafe = await getCafe(id);
    if (!cafe) {
      return NextResponse.json(
        { error: "not_found", message: "cafe not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(toPublicCafeDetail(cafe));
  } catch (err) {
    console.error("/api/cafes/[id] GET failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * DELETE /api/cafes/[id]
 * Soft-delete a cafe (issue #207, #219). Auth required; only creator can delete.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: "invalid_request", message: "id must be a UUID" },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "unauthorized", message: "authentication required" },
      { status: 401 },
    );
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await rateLimiter.check(
    `cafes-write:${clientId}`,
    CAFES_WRITE_RATE_LIMIT.windowMs,
    CAFES_WRITE_RATE_LIMIT.maxRequests,
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const exists = await cafeExists(id);
    if (!exists) {
      return NextResponse.json(
        { error: "not_found", message: "cafe not found" },
        { status: 404 },
      );
    }

    const ok = await softDeleteCafe(id, user.id);
    if (!ok) {
      // Disambiguate the false: non-creator vs a lost delete race (the cafe
      // was tombstoned between the probe above and the update — issue #228).
      const stillExists = await cafeExists(id);
      if (!stillExists) {
        return NextResponse.json(
          { error: "not_found", message: "cafe not found" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: "forbidden", message: "only creator can delete cafe" },
        { status: 403 },
      );
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("/api/cafes/[id] DELETE failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
