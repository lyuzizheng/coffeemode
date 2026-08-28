import "server-only";

import type { QueryResult } from "pg";
import type { CompleteImageRequest, ImageTargetType, StoredImage } from "@/types/images";
import type { ProcessUrls } from "./image-service-client";
import type { ProcessedImage } from "./processor";

/**
 * Service layer for POST /api/images/complete (issues #25, #261).
 *
 * The route stays a thin controller (auth, body validation, rate limiting,
 * error mapping); everything else lives here:
 *
 *   1. Intent & ownership pre-checks — fail fast BEFORE any remote work, so an
 *      unauthorized caller cannot burn image-service/CPU resources.
 *   2. Remote processing (image-service presign + sharp resize + R2 writes).
 *      Deliberately OUTSIDE the transaction: slow I/O must not hold a DB
 *      connection.
 *   3. DB writes in ONE transaction: for a checkin target, the checkin
 *      photo append and the cafe-gallery merge commit or roll back
 *      together via repositories, so the gallery can never diverge from the checkin.
 */

export type CompleteQueryFn = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/** Runs `fn` on one connection inside a transaction (BEGIN/COMMIT/ROLLBACK). */
export type RunInTransaction = <T>(fn: (q: CompleteQueryFn) => Promise<T>) => Promise<T>;

export type CompleteUploadFailureReason =
  | "intent_not_found"
  | "not_owned"
  | "intent_consumed"
  | "target_gone";

export type CompleteUploadResult =
  | {
      ok: true;
      storedImage: StoredImage;
      processed: ProcessedImage;
    }
  | {
      ok: false;
      reason: CompleteUploadFailureReason;
      storedImage?: undefined;
      processed?: undefined;
    };

export interface CompleteUploadDeps {
  /** Read-only pool query for pre-checks (optional override). */
  query?: CompleteQueryFn;
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
  ownsCafe: (cafeId: string, userId: string, q?: CompleteQueryFn) => Promise<boolean>;
  ownsCheckin: (checkinId: string, userId: string, q?: CompleteQueryFn) => Promise<boolean>;
  attachImageToCafe: (
    params: { cafeId: string; userId: string; image: StoredImage; isCover?: boolean },
    q?: CompleteQueryFn,
  ) => Promise<boolean>;
  attachImageToCheckin: (
    params: { checkinId: string; userId: string; image: StoredImage },
    q?: CompleteQueryFn,
  ) => Promise<{ ok: boolean; cafeId: string | null }>;
  mergeIntoCafeGallery: (cafeId: string, image: StoredImage, q?: CompleteQueryFn) => Promise<void>;
  getProcessUrls: (request: CompleteImageRequest & { userId?: string }) => Promise<ProcessUrls>;
  processImage: (imageUuid: string, processUrls: ProcessUrls) => Promise<ProcessedImage>;
}

/**
 * Default dependencies: shared Postgres pool, domain repositories, image-service client and
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
    ownsCafe: async (cafeId, userId, q) => {
      const { ownsCafe } = await import("@/lib/db/cafes");
      return ownsCafe(cafeId, userId, q);
    },
    ownsCheckin: async (checkinId, userId, q) => {
      const { ownsCheckin } = await import("@/lib/db/checkins");
      return ownsCheckin(checkinId, userId, q);
    },
    attachImageToCafe: async (params, q) => {
      const { attachImageToCafe } = await import("@/lib/db/cafes");
      return attachImageToCafe(params, q);
    },
    attachImageToCheckin: async (params, q) => {
      const { attachImageToCheckin } = await import("@/lib/db/checkins");
      return attachImageToCheckin(params, q);
    },
    mergeIntoCafeGallery: async (cafeId, image, q) => {
      const { mergeIntoCafeGallery } = await import("@/lib/db/checkins");
      return mergeIntoCafeGallery(cafeId, image, q);
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

/**
 * Complete an image upload: verify ownership, process variants remotely,
 * then attach the stored image to its target via repository methods.
 *
 * For a checkin target the checkin photo append and the cafe-gallery merge
 * happen inside one transaction — a failure in either rolls back both, so
 * no orphaned gallery entries or divergent states survive (issues #25, #261).
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
  if (!intentOk) return { ok: false, reason: "intent_not_found" };

  // 1. Fail fast before any remote work: unauthorized callers must not
  //    burn image-service presign or sharp CPU.
  const owned =
    req.targetType === "cafe"
      ? await deps.ownsCafe(req.targetId, user.id, deps.query)
      : await deps.ownsCheckin(req.targetId, user.id, deps.query);
  if (!owned) return { ok: false, reason: "not_owned" };

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
  //    gallery merge (issues #25, #33, #261).
  return deps.runInTransaction(async (q) => {
    const consumed = await deps.consumeUploadIntent(user.id, req.imageUuid, q);
    if (!consumed) return { ok: false, reason: "intent_consumed" };

    // NOTE: if the attach below matches 0 rows (the target was deleted or
    // changed owner between the pre-check and this tx), the intent is
    // already consumed — the complete fails closed and the user must re-upload.
    // Rare, fail-closed, accepted at MVP (review #33).
    if (req.targetType === "cafe") {
      const attached = await deps.attachImageToCafe(
        { cafeId: req.targetId, userId: user.id, image: storedImage, isCover: req.isCover ?? false },
        q,
      );
      if (!attached) return { ok: false, reason: "target_gone" };
      return { ok: true, storedImage, processed };
    }

    const { ok, cafeId } = await deps.attachImageToCheckin(
      { checkinId: req.targetId, userId: user.id, image: storedImage },
      q,
    );
    if (!ok) return { ok: false, reason: "target_gone" };
    if (cafeId) {
      await deps.mergeIntoCafeGallery(cafeId, storedImage, q);
    }
    return { ok: true, storedImage, processed };
  });
}
