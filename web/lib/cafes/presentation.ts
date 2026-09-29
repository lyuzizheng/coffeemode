import "server-only";

import type { PublicCafeDetail } from "@/types/cafes";
import { toPublicAuthor } from "@/types/identity";
import { isServiceMaintained } from "@/lib/db/cafes/meta";
import type { CafeDetailWithAuthor } from "@/lib/db/cafes/reads";

/**
 * Public cafe detail projection (spec 0001 DG13): strip creator id and `StoredImage.by`
 * from gallery so the anonymous surface never leaks internal author ids.
 * Null created_by falls back to the service account: `maintained_by_service`
 * is true and the client renders the localized maintainer line.
 * Author (spec 0006) is the consented creator projection; always null on the
 * anonymous / service-account / null-`created_by` path (architect correction).
 */
export function toPublicCafeDetail(
  cafe: CafeDetailWithAuthor,
  viewerId?: string | null,
): PublicCafeDetail {
  const serviceMaintained = isServiceMaintained(cafe.created_by);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip internal creator id + raw author columns (spec 0001 / DG13)
  const { created_by: _cb, gallery, author_handle: _ah, author_display_name: _an, author_avatar_url: _aa, ...rest } = cafe;
  return {
    ...rest,
    maintained_by_service: serviceMaintained,
    // DG146/DG147: the ownership bit is computed here, before created_by is
    // stripped — the client gets `owned_by_viewer`, never the creator id.
    owned_by_viewer: Boolean(viewerId) && cafe.created_by === viewerId,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip internal author id (DG13)
    gallery: (gallery ?? []).map(({ by: _by, ...image }) => image),
    author: serviceMaintained ? null : toPublicAuthor(cafe),
  };
}
