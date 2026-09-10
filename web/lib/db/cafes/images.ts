import "server-only";

import { isValidUUID } from "@shared/uuid";
import type { StoredImage } from "@/types/images";
import { query } from "../postgres";

const OWNS_CAFE_SQL = `
select id from cafes where id = $1 and created_by = $2 and deleted_at is null
`;

export async function ownsCafe(
  cafeId: string,
  userId: string,
  q = query,
): Promise<boolean> {
  if (!isValidUUID(cafeId) || !isValidUUID(userId)) return false;
  const result = await q<{ id: string }>(OWNS_CAFE_SQL, [cafeId, userId]);
  return result.rows.length > 0;
}

const ATTACH_IMAGE_TO_CAFE_SQL = `
update cafes
set gallery = coalesce(gallery, '[]'::jsonb) || (
  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  from jsonb_array_elements($1::jsonb) elem
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(gallery, '[]'::jsonb)) g
    where g->>'id' = elem->>'id'
  )
),
cover = case when $5::boolean then $2 else cover end
where id = $3 and created_by = $4 and deleted_at is null
returning id
`;

export async function attachImageToCafe(
  params: {
    cafeId: string;
    userId: string;
    image: StoredImage;
    isCover?: boolean;
  },
  q = query,
): Promise<boolean> {
  const coverKey = params.isCover ? params.image.card : null;
  const result = await q<{ id: string }>(ATTACH_IMAGE_TO_CAFE_SQL, [
    JSON.stringify([params.image]),
    coverKey,
    params.cafeId,
    params.userId,
    params.isCover ?? false,
  ]);
  return (result.rowCount ?? result.rows.length) > 0;
}
