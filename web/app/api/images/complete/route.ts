import { NextResponse } from "next/server";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";
import { getProcessUrls } from "@/lib/images/image-service-client";
import { processImage } from "@/lib/images/processor";
import { query } from "@/lib/db/postgres";
import type { CompleteImageRequest, CompleteImageResponse, ImageTargetType, StoredImage } from "@/types/images";

async function getUser(): Promise<{ id: string } | null> {
  if (!isAuthConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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

async function ownsCafe(cafeId: string, userId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `select id from cafes where id = $1 and created_by = $2`,
    [cafeId, userId],
  );
  return result.rows.length > 0;
}

async function ownsCheckin(checkinId: string, userId: string): Promise<{ cafeId: string | null } | null> {
  const result = await query<{ cafe_id: string | null }>(
    `select cafe_id from checkins where id = $1 and user_id = $2`,
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
     set gallery = coalesce(gallery, '[]'::jsonb) || $1::jsonb,
         cover = coalesce($2, cover)
     where id = $3 and created_by = $4
     returning id`,
    [JSON.stringify([image]), coverKey, cafeId, userId],
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
     set photos = coalesce(photos, '[]'::jsonb) || $1::jsonb
     where id = $2 and user_id = $3
     returning id, cafe_id`,
    [JSON.stringify([image]), checkinId, userId],
  );
  if (result.rows.length === 0) return { ok: false, cafeId: null };
  return { ok: true, cafeId: result.rows[0].cafe_id };
}

async function mergeIntoCafeGallery(image: StoredImage, cafeId: string): Promise<void> {
  await query(
    `update cafes
     set gallery = coalesce(gallery, '[]'::jsonb) || $1::jsonb
     where id = $2`,
    [JSON.stringify([image]), cafeId],
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
  const user = await getUser();
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
    const message = err instanceof Error ? err.message : "image_processing_error";
    return NextResponse.json({ error: "image_processing_error", message }, { status: 502 });
  }
}
