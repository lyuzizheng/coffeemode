import "server-only";

import type { TxQueryFn } from "@/lib/db/postgres";
import type { ImageTargetType, StoredImage } from "@/types/images";
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
    /**
     * Stage marker (issue #158 / BRAWUKA-400): the creation flow sends
     * `"provision"` (pre-target); the post-commit attach leg re-sends
     * `"checkin"` + the real check-in id so the sweeper never matches it.
     * Required since #158 — the worker rejects marker-less completes.
     */
    targetType: "provision" | ImageTargetType;
    targetId: string;
  }) => Promise<ProcessUrls>;
  processImage: (imageUuid: string, processUrls: ProcessUrls) => Promise<ProcessedImage>;
  /**
   * Post-commit attach re-mark (BRAWUKA-400): download the live original and
   * re-PUT it with the final targetType/targetId metadata. Never throws past
   * the caller — failures are logged, and the key stays DB-referenced so the
   * reference-aware sweeper keeps it. Defaults to `getProcessUrls` (final
   * stage) + `restampOriginal` from the sharp processor.
   */
  restampOriginal?: (attachUrls: ProcessUrls) => Promise<void>;
  /**
   * Best-effort R2 compensation (BRAWUKA-279): delete the variants
   * `processImage` already wrote when the caller's transaction rolls back.
   * Defaults to the image-service delete endpoint; never throws past the
   * caller (compensation failure is logged, not rethrown).
   */
  deleteProvisionedVariants?: (imageUuid: string) => Promise<void>;
  /**
   * Reference gate for R2 compensation (BRAWUKA-401): ids still referenced
   * by `cafes.gallery` / `checkins.photos`. `compensateProvisionedPhotos`
   * deletes only the unreferenced ids, so a loser's rollback never removes
   * a concurrent winner's committed objects (shared deterministic keys).
   * Absent in legacy fakes — compensation then deletes every id as before.
   */
  selectPhotoReferences?: (imageUuids: string[]) => Promise<string[]>;
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
    processImage: async (imageUuid, processUrls) => {
      const { processImage } = await import("@/lib/images/processor");
      return processImage(imageUuid, processUrls);
    },
    restampOriginal: async (attachUrls) => {
      const { restampOriginal } = await import("@/lib/images/processor");
      return restampOriginal(attachUrls);
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
    deleteProvisionedVariants: async (imageUuid) => {
      const { deleteImageVariants } = await import("@/lib/images/image-service-client");
      const { logError } = await import("@/lib/observability/server-log");
      try {
        await deleteImageVariants(imageUuid);
      } catch (err) {
        logError({ route: "provision-photos compensate", error: err });
      }
    },
    selectPhotoReferences: async (imageUuids) => {
      const { selectPhotoReferences } = await import("@/lib/db/photo-references");
      return selectPhotoReferences(imageUuids);
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
  // Every claimed index (BRAWUKA-432): a failed index may hold partial R2
  // writes (`processImage` uploads 3 variants concurrently), and a sibling
  // that finishes after `Promise.all` rejects must still be compensated.
  const started = new Set<number>();
  let failed = false;
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
      while (!failed && next < photoIds.length) {
        const index = next;
        next += 1;
        started.add(index);
        results[index] = await processOne(photoIds[index] as string);
      }
    },
  );
  try {
    await Promise.all(workers);
  } catch (err) {
    // Stop unclaimed work, wait out the in-flight sibling, then compensate
    // every started id. The reference gate inside compensation keeps a
    // concurrent creation's committed objects alive.
    failed = true;
    await Promise.allSettled(workers);
    const doneIds = photoIds.filter((_, index) => started.has(index));
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
 *
 * Reference gate (BRAWUKA-401): concurrent creates share deterministic R2
 * keys, so a loser's rollback must not delete a concurrent winner's
 * committed objects. Ids still referenced by `cafes.gallery` /
 * `checkins.photos` are kept (the winner's rows prove them live); only true
 * orphans are deleted. A failed gate check fails closed — keep the id and
 * let the sweeper decide — so a DB blip can leak (swept later) but never
 * corrupt a committed photo.
 */
export async function compensateProvisionedPhotos(
  photoIds: string[],
  deps: ProvisionPhotosDeps,
): Promise<void> {
  if (!deps.deleteProvisionedVariants) return;
  let orphans = photoIds;
  if (deps.selectPhotoReferences && photoIds.length > 0) {
    try {
      const referenced = new Set(await deps.selectPhotoReferences(photoIds));
      orphans = photoIds.filter((id) => !referenced.has(id));
    } catch {
      return;
    }
  }
  await Promise.allSettled(orphans.map((id) => deps.deleteProvisionedVariants!(id)));
}

/** One photo's attach outcome: the key stays DB-referenced either way. */
export interface AttachPhotoResult {
  imageUuid: string;
  attached: boolean;
}

/**
 * Post-commit attach re-mark (BRAWUKA-400, fix option A): after the creation
 * transaction commits, re-mark every live original from `provision` to the
 * real target (`checkin` + the new check-in id) so the #158 sweeper never
 * matches it. Runs OUTSIDE the transaction — slow I/O must not hold a DB
 * connection — and NEVER throws: a per-photo presign/process failure is
 * logged and reported as `attached: false`, because the DB row already
 * committed and the reference-aware sweeper keeps DB-referenced keys. Calls
 * with an empty list return `[]` without touching deps. Legacy fakes without
 * `restampOriginal` still mark intent via presign: the download/re-PUT is
 * skipped and the photo counts as attached when the final-stage presign
 * succeeds.
 */
export async function attachProvisionedPhotos(
  userId: string,
  photoIds: string[],
  checkinId: string,
  deps: ProvisionPhotosDeps,
): Promise<AttachPhotoResult[]> {
  if (photoIds.length === 0) return [];
  const restamp = deps.restampOriginal;
  const results = await Promise.all(
    photoIds.map(async (imageUuid): Promise<AttachPhotoResult> => {
      try {
        const attachUrls = await deps.getProcessUrls({
          imageUuid,
          userId,
          targetType: "checkin",
          targetId: checkinId,
        });
        if (restamp) await restamp(attachUrls);
        return { imageUuid, attached: true };
      } catch (err) {
        const { logError } = await import("@/lib/observability/server-log");
        logError({ route: "provision-photos attach", error: err });
        return { imageUuid, attached: false };
      }
    }),
  );
  return results;
}
