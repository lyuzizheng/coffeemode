import "server-only";

import type { QueryResult } from "pg";
import { MERGE_GALLERY_SQL } from "@/lib/db/checkins";
import type { CompleteImageRequest, ImageTargetType, StoredImage } from "@/types/images";
import type { ProcessUrls } from "./image-service-client";
import type { ProcessedImage } from "./processor";

/**
 * Service layer for POST /api/images/complete (issue #25).
 *
 * The route stays a thin controller (auth, body validation, rate limiting,
 * error mapping); everything else lives here:
 *
 *   1. Ownership pre-check — fail fast BEFORE any remote work, so an
 *      unauthorized caller cannot burn image-service/CPU resources.
 *   2. Remote processing (image-service presign + sharp resize + R2 writes).
 *      Deliberately OUTSIDE the transaction: slow I/O must not hold a DB
 *      connection.
 *   3. DB writes in ONE transaction: for a checkin target, the checkin
 *      photo append and the cafe-gallery merge commit or roll back
 *      together, so the gallery can never diverge from the checkin.
 */

export type CompleteQueryFn = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/** Runs `fn` on one connection inside a transaction (BEGIN/COMMIT/ROLLBACK). */
export type RunInTransaction = <T>(fn: (q: CompleteQueryFn) => Promise<T>) => Promise<T>;

export interface CompleteUploadDeps {
  /** Read-only pool query for the ownership pre-check. */
  query: CompleteQueryFn;
  /** Transaction runner for the atomic DB writes. */
  runInTransaction: RunInTransaction;
  /**
   * Upload-intent binding (issue #33): was this imageUuid issued to this
   * user? Checked BEFORE remote work so a caller with someone else's
   * (leaked) upload cannot burn image-service presign/sharp resources.
   */
  checkUploadIntent: (userId: string, imageUuid: string) => Promise<boolean>;
  /**
   * Single-use consume of the intent INSIDE the atomic transaction, so a
   * replay or a mismatched user rolls the attach back (issue #33).
   */
  consumeUploadIntent: (
    userId: string,
    imageUuid: string,
    q: CompleteQueryFn,
  ) => Promise<boolean>;
  getProcessUrls: (request: CompleteImageRequest & { userId?: string }) => Promise<ProcessUrls>;
  processImage: (imageUuid: string, processUrls: ProcessUrls) => Promise<ProcessedImage>;
}

export interface CompleteUploadResult {
  attached: boolean;
  storedImage?: StoredImage;
  processed?: ProcessedImage;
}

/**
 * Default dependencies: shared Postgres pool, image-service client and
 * sharp processor. Each is imported lazily so unit tests (which inject
 * fakes) and unrelated builds never load pg/sharp.
 */
export function defaultCompleteUploadDeps(): CompleteUploadDeps {
  return {
    query: async (text, params) => {
      const { query } = await import("@/lib/db/postgres");
      return query(text, params);
    },
    runInTransaction: async (fn) => {
      const { withTransaction } = await import("@/lib/db/postgres");
      return withTransaction(async (client) =>
        fn(client.query.bind(client) as CompleteQueryFn),
      );
    },
    checkUploadIntent: async (userId, imageUuid) => {
      const { checkUploadIntent } = await import("@/lib/db/image-uploads");
      return checkUploadIntent(userId, imageUuid);
    },
    consumeUploadIntent: async (userId, imageUuid, q) => {
      const { consumeUploadIntent } = await import("@/lib/db/image-uploads");
      return consumeUploadIntent(userId, imageUuid, q);
    },
    getProcessUrls: async (request) => {
      const { getProcessUrls } = await import("@/lib/images/image-service-client");
      return getProcessUrls(request);
    },
    processImage: async (imageUuid, processUrls) => {
      const { processImage } = await import("@/lib/images/processor");
      return processImage(imageUuid, processUrls);
    },
  };
}

/** Structural guard for errors thrown by the image-service client. */
export function isImageServiceError(err: unknown): err is { status: number; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  );
}

async function ownsCafe(q: CompleteQueryFn, cafeId: string, userId: string): Promise<boolean> {
  const result = await q<{ id: string }>(
    `select id from cafes where id = $1 and created_by = $2 and deleted_at is null`,
    [cafeId, userId],
  );
  return result.rows.length > 0;
}

async function ownsCheckin(
  q: CompleteQueryFn,
  checkinId: string,
  userId: string,
): Promise<boolean> {
  const result = await q<{ cafe_id: string | null }>(
    `select cafe_id from checkins where id = $1 and user_id = $2 and deleted_at is null`,
    [checkinId, userId],
  );
  return result.rows.length > 0;
}

async function attachToCafe(
  q: CompleteQueryFn,
  image: StoredImage,
  cafeId: string,
  userId: string,
  isCover: boolean,
): Promise<boolean> {
  const coverKey = isCover ? image.card : null;
  const result = await q<{ id: string }>(
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
  q: CompleteQueryFn,
  image: StoredImage,
  checkinId: string,
  userId: string,
): Promise<{ ok: boolean; cafeId: string | null }> {
  const result = await q<{ id: string; cafe_id: string | null }>(
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

async function mergeIntoCafeGallery(q: CompleteQueryFn, image: StoredImage, cafeId: string): Promise<void> {
  await q(MERGE_GALLERY_SQL, [cafeId, JSON.stringify([image])]);
}

/**
 * Complete an image upload: verify ownership, process variants remotely,
 * then attach the stored image to its target.
 *
 * For a checkin target the checkin photo append and the cafe-gallery merge
 * happen inside one transaction — a failure in either rolls back both, so
 * no orphaned gallery entries or divergent states survive (issue #25).
 */
export async function completeImageUpload(
  user: { id: string },
  req: CompleteImageRequest,
  deps: CompleteUploadDeps,
): Promise<CompleteUploadResult> {
  // 0. Upload-intent binding (issue #33): this imageUuid must have been
  //    issued to THIS user at upload time, or a leaked URL would let
  //    anyone claim the image. Fail fast before any remote work.
  const intentOk = await deps.checkUploadIntent(user.id, req.imageUuid);
  if (!intentOk) return { attached: false };

  // 1. Fail fast before any remote work: unauthorized callers must not
  //    burn image-service presign or sharp CPU.
  const owned =
    req.targetType === "cafe"
      ? await ownsCafe(deps.query, req.targetId, user.id)
      : await ownsCheckin(deps.query, req.targetId, user.id);
  if (!owned) return { attached: false };

  // 2. Remote processing OUTSIDE the transaction: presign + resize + R2
  //    are slow I/O and must not hold a DB connection.
  const processUrls = await deps.getProcessUrls({ ...req, userId: user.id });
  const processed = await deps.processImage(req.imageUuid, processUrls);

  // The provision stage never reaches here: completeImageUpload attaches to a
  // real cafe/check-in, so the route validation has already narrowed the type.
  const sourceType = req.targetType as ImageTargetType;
  const storedImage: StoredImage = {
    id: req.imageUuid,
    original: processUrls.keys.original,
    card: processUrls.keys.card,
    thumbnail: processUrls.keys.thumbnail,
    w: processed.width,
    h: processed.height,
    by: user.id,
    at: new Date().toISOString(),
    source: { type: sourceType, id: req.targetId },
  };

  // 3. Atomic DB writes: the single-use intent consume and the attach
  //    share one transaction, so a replayed/mismatched intent rolls the
  //    attach back, and a failure rolls back the checkin append AND the
  //    gallery merge (issues #25, #33).
  return deps.runInTransaction(async (q) => {
    const consumed = await deps.consumeUploadIntent(user.id, req.imageUuid, q);
    if (!consumed) return { attached: false };

    // NOTE: if the attach below matches 0 rows (the target was deleted or
    // changed owner between the pre-check and this tx), the intent is
    // already consumed — the complete 404s and the user must re-upload.
    // Rare, fail-closed, accepted at MVP (review #33).
    if (req.targetType === "cafe") {
      const attached = await attachToCafe(q, storedImage, req.targetId, user.id, req.isCover ?? false);
      return { attached, storedImage, processed };
    }

    const { ok, cafeId } = await attachToCheckin(q, storedImage, req.targetId, user.id);
    if (ok && cafeId) {
      await mergeIntoCafeGallery(q, storedImage, cafeId);
    }
    return { attached: ok, storedImage, processed };
  });
}
