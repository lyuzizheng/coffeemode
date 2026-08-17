import "server-only";

import type { QueryResult } from "pg";
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
 *   1. Fail-fast pre-check the upload intent (issue #33 binding) BEFORE any
 *      remote work, so a caller holding someone else's (leaked) imageUuid
 *      cannot burn image-service presign or sharp CPU.
 *   2. Process the image (presign + sharp resize + R2 writes) OUTSIDE any
 *      transaction — slow I/O must not hold a DB connection.
 *   3. Build the StoredImage server-side: deterministic R2 keys from the
 *      process URLs, real dimensions from sharp, `by` = the caller.
 *
 * The single-use intent consume happens later, INSIDE the creation
 * transaction (`consumeProvisionedIntents`), so the consume commits or rolls
 * back together with the cafe/check-in insert and gallery merge.
 */

/** Minimal query-fn shape so consume can run on a transaction connection. */
export type ProvisionQueryFn = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

export interface ProvisionPhotosDeps {
  checkUploadIntent: (userId: string, imageUuid: string) => Promise<boolean>;
  consumeUploadIntent: (
    userId: string,
    imageUuid: string,
    q: ProvisionQueryFn,
  ) => Promise<boolean>;
  getProcessUrls: (request: { imageUuid: string; userId?: string }) => Promise<ProcessUrls>;
  processImage: (imageUuid: string, processUrls: ProcessUrls) => Promise<ProcessedImage>;
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
 * Pre-check intents and process every photo id, sequentially (sharp is CPU
 * work; bounded by the per-request photo cap). Throws PhotoIntentError on
 * the first id whose intent does not check out — before that image is
 * processed.
 */
export async function provisionPhotos(
  userId: string,
  photoIds: string[],
  deps: ProvisionPhotosDeps,
): Promise<ProvisionedPhoto[]> {
  const provisioned: ProvisionedPhoto[] = [];
  for (const imageUuid of photoIds) {
    const intentOk = await deps.checkUploadIntent(userId, imageUuid);
    if (!intentOk) throw new PhotoIntentError();

    const processUrls = await deps.getProcessUrls({ imageUuid, userId });
    const processed = await deps.processImage(imageUuid, processUrls);

    provisioned.push({
      id: imageUuid,
      original: processUrls.keys.original,
      card: processUrls.keys.card,
      thumbnail: processUrls.keys.thumbnail,
      w: processed.width,
      h: processed.height,
      by: userId,
      at: new Date().toISOString(),
    });
  }
  return provisioned;
}

/**
 * Consume every photo's upload intent inside the caller's transaction. Any
 * id that fails to consume (replay, foreign, or expired since the
 * pre-check) throws PhotoIntentError so the whole creation rolls back —
 * the DELETEs roll back too, leaving the remaining intents reusable.
 */
export async function consumeProvisionedIntents(
  userId: string,
  photoIds: string[],
  q: ProvisionQueryFn,
  deps: ProvisionPhotosDeps,
): Promise<void> {
  for (const imageUuid of photoIds) {
    const consumed = await deps.consumeUploadIntent(userId, imageUuid, q);
    if (!consumed) throw new PhotoIntentError();
  }
}
