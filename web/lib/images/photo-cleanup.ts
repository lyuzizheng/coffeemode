import "server-only";

import { logError } from "@/lib/observability/server-log";
import type { ProvisionPhotosDeps } from "./provision-photos";

/**
 * Post-commit R2 cleanup for the delete paths (BRAWUKA-433): soft-deleting
 * a check-in (directly, via `deleteCafe`, or via `deleteAccount`) removes
 * its gallery entries but leaves the tombstoned row's photos — and their
 * `original/` + `card/` + `thumbnail/` objects — publicly reachable
 * forever. Called AFTER the delete transaction commits, so the just-
 * deleted rows no longer count as live references; deletes every id no
 * LIVE row still names. Best-effort like the rollback compensation in
 * `provision-photos.ts`: failures are swallowed (logged inside the dep)
 * and never fail the already-committed delete.
 *
 * No live-intent gate here, unlike `compensateProvisionedPhotos`: intents
 * are single-use and consumed when the photo attached, so a live intent
 * can only exist for an upload that was never attached — which no row
 * references and no delete path can reach.
 */
export async function deleteUnreferencedPhotos(
  photoIds: string[],
  deps: ProvisionPhotosDeps,
): Promise<void> {
  if (!deps.deleteProvisionedVariants) return;
  let orphans = [...new Set(photoIds)];
  if (deps.selectLivePhotoReferences && orphans.length > 0) {
    try {
      const referenced = new Set(await deps.selectLivePhotoReferences(orphans));
      orphans = orphans.filter((id) => !referenced.has(id));
    } catch (err) {
      logError({ route: "photo-cleanup delete gate", error: err });
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
        logError({ route: "photo-cleanup attach", error: err });
        return { imageUuid, attached: false };
      }
    }),
  );
  return results;
}
