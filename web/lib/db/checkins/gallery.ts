import "server-only";

import type { ProvisionedPhoto } from "@/lib/images/provision-photos";
import type { StoredImage } from "@/types/images";

/**
 * Append check-in photos to cafes.gallery with provenance (spec 0001:
 * photos auto-merge, no curator approval at MVP; the `source` field on
 * server-derived photos lets gallery queries hide photos from soft-deleted
 * check-ins). Guarded per-element by photo id to prevent duplicate entries
 * even across timestamp re-stamping and partial array overlap (issues #234, #258).
 * The existing gallery's id set is materialized once in `existing_ids` and
 * anti-joined against the incoming elements, so the merge is O(gallery +
 * payload) instead of re-expanding the gallery per new element (BRAWUKA-650).
 * Precondition: $2 array must not contain intra-array duplicate IDs (guaranteed
 * by parsePhotoIds validation on the create paths).
 */
export const MERGE_GALLERY_SQL = `
with existing_ids as (
  select distinct g->>'id' as id
  from cafes, jsonb_array_elements(coalesce(gallery, '[]'::jsonb)) g
  where cafes.id = $1
)
update cafes
set gallery = coalesce(gallery, '[]'::jsonb) || (
  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  from jsonb_array_elements($2::jsonb) elem
  where not exists (
    select 1
    from existing_ids e
    where e.id = elem->>'id'
  )
)
where id = $1
`;

/** Attach the check-in id as each photo's `source` (soft-delete hiding). */
export function photosWithSource(photos: ProvisionedPhoto[], checkinId: string): StoredImage[] {
  return photos.map((p) => ({ ...p, source: { type: "checkin" as const, id: checkinId } }));
}
