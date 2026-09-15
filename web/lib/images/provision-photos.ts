import "server-only";

import type { TxQueryFn } from "@/lib/db/postgres";
import type { StoredImage } from "@/types/images";
import type { ProcessUrls } from "./image-service-client";
import type { ProcessedImage } from "./processor";

/**
 * Server-side photo provisioning for the creation/check-in write paths
 * (issue #86).
 *
 * Clients send only `photo_ids` (imageUuids from /api/images/upload); the
 * server derives everything else. For each id we:
 *
 *   1. Fail-fast pre-check ALL upload intents in ONE batched query (issue
 *      #33 binding, BRAWUKA-279) BEFORE any remote work, so a caller holding
 *      someone else's (leaked) imageUuid cannot burn image-service presign
 *      or sharp CPU.
 *   2. Process the image (presign + sharp resize + R2 writes) OUTSIDE any
 *      transaction — slow I/O must not hold a DB connection.
 *   3. Build the StoredImage server-side: deterministic R2 keys from the
 *      process URLs, real dimensions from sharp, `by` = the caller.
 *
 * The single-use intent consume happens later, INSIDE the creation
 * transaction (`consumeProvisionedIntents`, one batched DELETE), so the
 * consume commits or rolls back together with the cafe/check-in insert and
 * gallery merge. When that transaction rolls back, the caller runs
 * `compensateProvisionedPhotos` (best-effort R2 deletes via the
 * image-service delete endpoint); the #158 sweeper stays the backstop.
 */

/**
 * Minimal query-fn shape so consume can run on a transaction connection.
 * Canonical shape lives in `lib/db/postgres` (spec 0009 §Edge cases 6).
 */
export type ProvisionQueryFn = TxQueryFn;

export interface ProvisionPhotosDeps {
  checkUploadIntent: (userId: string, imageUuid: string) => Promise<boolean>;
  /**
   * Batch pre-check for multi-photo creates (BRAWUKA-281 P1): one batched
   * DB round trip instead of N sequential `checkUploadIntent` reads.
   * Returns the subset of `imageUuids` whose intent is valid. Defaults to
   * N parallel `checkUploadIntent` calls when the caller only supplies the
   * per-id check (tests, legacy fakes); the production factory below wires
   * the real batched query.
   */
  checkUploadIntents?: (userId: string, imageUuids: string[]) => Promise<string[]>;
  consumeUploadIntent: (
    userId: string,
    imageUuid: string,
    q: ProvisionQueryFn,
  ) => Promise<boolean>;
  /**
   * Batched single-use consume (BRAWUKA-279): one DELETE inside the caller's
   * transaction regardless of photo count. Falls back to per-id
   * `consumeUploadIntent` calls when absent (tests, legacy fakes).
   */
  consumeUploadIntents?: (
    userId: string,
    imageUuids: string[],
    q: ProvisionQueryFn,
  ) => Promise<boolean>;
  getProcessUrls: (request: {
    imageUuid: string;
    userId?: string;
    /** Pre-target stage marker (issue #158): "provision" + targetId=imageUuid. */
    targetType?: "provision";
    targetId?: string;
  }) => Promise<ProcessUrls>;
  processImage: (imageUuid: string, processUrls: ProcessUrls) => Promise<ProcessedImage>;
  /**
   * Best-effort R2 compensation (BRAWUKA-279): delete the variants
   * `processImage` already wrote when the caller's transaction rolls back.
   * Defaults to the image-service delete endpoint; never throws past the
   * caller (compensation failure is logged, not rethrown).
   */
  deleteProvisionedVariants?: (imageUuid: string) => Promise<void>;
}

/**
 * Default dependencies: image-uploads intents, image-service client and
 * sharp processor. Imported lazily so unit tests (which inject fakes) and
 * unrelated builds never load pg/sharp.
 */
export function defaultProvisionPhotosDeps(): ProvisionPhotosDeps {
  return {
    checkUploadIntent: async (userId, imageUuid) => {
      const { checkUploadIntent } = await import("@/lib/db/image-uploads");
      return checkUploadIntent(userId, imageUuid);
    },
    checkUploadIntents: async (userId, imageUuids) => {
      const { checkUploadIntents } = await import("@/lib/db/image-uploads");
      return checkUploadIntents(userId, imageUuids);
    },
    consumeUploadIntent: async (userId, imageUuid, q) => {
      const { consumeUploadIntent } = await import("@/lib/db/image-uploads");
      return consumeUploadIntent(userId, imageUuid, q);
    },
    consumeUploadIntents: async (userId, imageUuids, q) => {
      const { consumeUploadIntents } = await import("@/lib/db/image-uploads");
      return consumeUploadIntents(userId, imageUuids, q);
    },
    getProcessUrls: async (request) => {
      const { getProcessUrls } = await import("@/lib/images/image-service-client");
      return getProcessUrls(request);
    },
    processImage: async (imageUuid, processUrls) => {
      const { processImage } = await import("@/lib/images/processor");
      return processImage(imageUuid, processUrls);
    },
    deleteProvisionedVariants: async (imageUuid) => {
      const { deleteImageVariants } = await import("@/lib/images/image-service-client");
      const { logError } = await import("@/lib/observability/server-log");
      try {
        await deleteImageVariants(imageUuid);
      } catch (err) {
        logError({ route: "provision-photos compensate", error: err });
      }
    },
  };
}

/**
 * A photo whose upload intent check failed: not issued to this user,
 * expired, or already consumed. Thrown before any remote work; routes map
 * this to 400 with a generic message (no oracle on which id or why).
 */
export class PhotoIntentError extends Error {
  constructor() {
    super("one or more photos are invalid");
    this.name = "PhotoIntentError";
  }
}

/** StoredImage without `source` — the target id only exists after insert. */
export type ProvisionedPhoto = Omit<StoredImage, "source">;
/**
 * Batch intent pre-check, then bounded-concurrency processing (BRAWUKA-281
 * P1). All intents resolve BEFORE any remote work — a caller holding a
 * leaked/expired id burns no image-service presign or sharp CPU. Processing
 * runs with concurrency 2 (sharp is CPU work; `processImage` already
 * parallelizes its own 3 resize/upload legs internally). Output order
 * follows input order. A mid-loop remote failure compensates the
 * already-provisioned ids best-effort (P2 review: same leak class as the
 * audited item, one step earlier) before rethrowing the original error.
 */
export async function provisionPhotos(
  userId: string,
  photoIds: string[],
  deps: ProvisionPhotosDeps,
): Promise<ProvisionedPhoto[]> {
  if (photoIds.length === 0) return [];

  const validIds = deps.checkUploadIntents
    ? await deps.checkUploadIntents(userId, photoIds)
    : (
        await Promise.all(
          photoIds.map(async (imageUuid) =>
            (await deps.checkUploadIntent(userId, imageUuid)) ? imageUuid : null,
          ),
        )
      ).filter((id): id is string => id !== null);
  if (validIds.length !== photoIds.length) throw new PhotoIntentError();

  const CONCURRENCY = 2;
  const results = new Array<ProvisionedPhoto>(photoIds.length);
  let next = 0;
  const processOne = async (imageUuid: string): Promise<ProvisionedPhoto> => {
    const processUrls = await deps.getProcessUrls({
      imageUuid,
      userId,
      // Pre-target stage (issue #86): the cafe/check-in does not exist yet.
      // The worker stamps targetType="provision" + targetId=<imageUuid>; the
      // attach flow re-PUTs with the real target later. Required since #158:
      // the worker rejects marker-less completes so cleanup can distinguish
      // live originals from abandoned uploads.
      targetType: "provision",
      targetId: imageUuid,
    });
    const processed = await deps.processImage(imageUuid, processUrls);

    return {
      id: imageUuid,
      original: processUrls.keys.original,
      card: processUrls.keys.card,
      thumbnail: processUrls.keys.thumbnail,
      w: processed.width,
      h: processed.height,
      by: userId,
      at: new Date().toISOString(),
    };
  };
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, photoIds.length) },
    async () => {
      while (next < photoIds.length) {
        const index = next;
        next += 1;
        results[index] = await processOne(photoIds[index] as string);
      }
    },
  );
  try {
    await Promise.all(workers);
  } catch (err) {
    const doneIds = results.filter((r): r is ProvisionedPhoto => r !== undefined).map((r) => r.id);
    await compensateProvisionedPhotos(doneIds, deps);
    throw err;
  }
  return results;
}


/**
 * Consume every photo's upload intent inside the caller's transaction. Any
 * id that fails to consume (replay, foreign, or expired since the
 * pre-check) throws PhotoIntentError so the whole creation rolls back —
 * the DELETE rolls back too, leaving the remaining intents reusable.
 * Prefers the batched `consumeUploadIntents` seam (one DELETE); falls back
 * to per-id `consumeUploadIntent` calls for legacy fakes.
 */
export async function consumeProvisionedIntents(
  userId: string,
  photoIds: string[],
  q: ProvisionQueryFn,
  deps: ProvisionPhotosDeps,
): Promise<void> {
  if (photoIds.length === 0) return;
  if (deps.consumeUploadIntents) {
    const consumed = await deps.consumeUploadIntents(userId, photoIds, q);
    if (!consumed) throw new PhotoIntentError();
    return;
  }
  for (const imageUuid of photoIds) {
    const consumed = await deps.consumeUploadIntent(userId, imageUuid, q);
    if (!consumed) throw new PhotoIntentError();
  }
}
/**
 * Best-effort R2 compensation for a rolled-back creation (BRAWUKA-279):
 * delete the variants `provisionPhotos` already wrote. Called AFTER the
 * transaction throws, so the DB side has already rolled back; R2 has no
 * transaction, hence this explicit cleanup. Failures are swallowed (logged
 * inside the dep) — the caller must rethrow its original error, and the
 * #158 sweeper remains the backstop for anything this misses.
 */
export async function compensateProvisionedPhotos(
  photoIds: string[],
  deps: ProvisionPhotosDeps,
): Promise<void> {
  if (!deps.deleteProvisionedVariants) return;
  await Promise.allSettled(photoIds.map((id) => deps.deleteProvisionedVariants!(id)));
}
