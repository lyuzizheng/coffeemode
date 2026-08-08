import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { isValidUUID } from "@/lib/validation";
import { getProcessUrls } from "@/lib/images/image-service-client";
import { processImage } from "@/lib/images/processor";
import { query } from "@/lib/db/postgres";
import {
  IMAGE_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
import type { CompleteImageRequest, CompleteImageResponse, ImageTargetType, StoredImage } from "@/types/images";

export const runtime = "nodejs";

function validateBody(body: unknown): CompleteImageRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.imageUuid !== "string" || typeof b.targetId !== "string") return null;
  if (b.targetType !== "cafe" && b.targetType !== "checkin") return null;
  const imageUuid = b.imageUuid.toLowerCase();
  const targetId = b.targetId.toLowerCase();
  if (!isValidUUID(imageUuid) || !isValidUUID(targetId)) return null;
  return {
    imageUuid,
    targetType: b.targetType as ImageTargetType,
    targetId,
    isCover: b.isCover === true,
  };
}

function isImageServiceError(err: unknown): err is { status: number; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  );
}

async function ownsCafe(cafeId: string, userId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `select id from cafes where id = $1 and created_by = $2`,
    [cafeId, userId],
  );
  return result.rows.length > 0;
}

async function ownsCheckin(checkinId: string, userId: string): Promise<{ cafeId: string | null } | null> {
  const result = await query<{ cafe_id: string | null }>(
    `select cafe_id from checkins where id = $1 and user_id = $2 and deleted_at is null`,
    [checkinId, userId],
  );
  if (result.rows.length === 0) return null;
  return { cafeId: result.rows[0].cafe_id };
}

async function attachToCafe(
  image: StoredImage,
  cafeId: string,
  userId: string,
  isCover: boolean,
): Promise<boolean> {
  const coverKey = isCover ? image.card : null;
  const result = await query<{ id: string }>(
    `update cafes
     set gallery = case
         when not (coalesce(gallery, '[]'::jsonb) @> $5::jsonb)
         then coalesce(gallery, '[]'::jsonb) || $1::jsonb
         else gallery
       end,
       cover = case when $6::boolean then $2 else cover end
     where id = $3 and created_by = $4
     returning id`,
    [JSON.stringify([image]), coverKey, cafeId, userId, JSON.stringify([{ id: image.id }]), isCover],
  );
  return result.rows.length > 0;
}

async function attachToCheckin(
  image: StoredImage,
  checkinId: string,
  userId: string,
): Promise<{ ok: boolean; cafeId: string | null }> {
  const result = await query<{ id: string; cafe_id: string | null }>(
    `update checkins
     set photos = case
         when not (coalesce(photos, '[]'::jsonb) @> $4::jsonb)
         then coalesce(photos, '[]'::jsonb) || $1::jsonb
         else photos
       end
     where id = $2 and user_id = $3 and deleted_at is null
     returning id, cafe_id`,
    [JSON.stringify([image]), checkinId, userId, JSON.stringify([{ id: image.id }])],
  );
  if (result.rows.length === 0) return { ok: false, cafeId: null };
  return { ok: true, cafeId: result.rows[0].cafe_id };
}

async function mergeIntoCafeGallery(image: StoredImage, cafeId: string): Promise<void> {
  await query(
    `update cafes
     set gallery = case
         when not (coalesce(gallery, '[]'::jsonb) @> $3::jsonb)
         then coalesce(gallery, '[]'::jsonb) || $1::jsonb
         else gallery
       end
     where id = $2`,
    [JSON.stringify([image]), cafeId, JSON.stringify([{ id: image.id }])],
  );
}

/**
 * POST /api/images/complete
 *
 * Called by the browser after it has uploaded the original to R2.
 * Verifies ownership before doing any remote work, then resizes to card +
 * thumbnail, writes them back to R2, and appends the image record to the
 * target cafe or checkin.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const req = validateBody(body);
  if (!req) {
    return NextResponse.json(
      { error: "invalid_request", message: "valid imageUuid, targetType (cafe|checkin), and targetId required" },
      { status: 400 },
    );
  }

  const clientId = getClientIdentifier(request, user);
  const limit = rateLimiter.check(
    `images:${clientId}`,
    IMAGE_RATE_LIMIT.windowMs,
    IMAGE_RATE_LIMIT.maxRequests,
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit);
  }

  const owned =
    req.targetType === "cafe"
      ? await ownsCafe(req.targetId, user.id)
      : await ownsCheckin(req.targetId, user.id);

  if (!owned) {
    return NextResponse.json({ error: "not_found", message: "target not found or not owned by user" }, { status: 404 });
  }

  try {
    const processUrls = await getProcessUrls({
      imageUuid: req.imageUuid,
      userId: user.id,
      targetType: req.targetType,
      targetId: req.targetId,
    });

    const processed = await processImage(req.imageUuid, processUrls);

    const storedImage: StoredImage = {
      id: req.imageUuid,
      original: processUrls.keys.original,
      card: processUrls.keys.card,
      thumbnail: processUrls.keys.thumbnail,
      w: processed.width,
      h: processed.height,
      by: user.id,
      at: new Date().toISOString(),
      source: { type: req.targetType, id: req.targetId },
    };

    let attached: boolean;
    if (req.targetType === "cafe") {
      attached = await attachToCafe(storedImage, req.targetId, user.id, req.isCover ?? false);
    } else {
      const { ok, cafeId } = await attachToCheckin(storedImage, req.targetId, user.id);
      attached = ok;
      if (ok && cafeId) {
        await mergeIntoCafeGallery(storedImage, cafeId);
      }
    }

    if (!attached) {
      return NextResponse.json({ error: "not_found", message: "target not found or not owned by user" }, { status: 404 });
    }

    const response: CompleteImageResponse = {
      imageUuid: processed.imageUuid,
      publicUrls: processed.publicUrls,
      width: processed.width,
      height: processed.height,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("/api/images/complete failed", err);
    if (isImageServiceError(err)) {
      return NextResponse.json(
        { error: "image_service_error", message: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "image_processing_error" }, { status: 502 });
  }
}
