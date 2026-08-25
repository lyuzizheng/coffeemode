import "server-only";

import { appConfig } from "@/lib/config";
import { coerceWorkStats } from "@/lib/stats/work-stats";
import type { CafeSummary } from "@/types/cafes";
import { query } from "./postgres";

export interface SearchCafesDbParams {
  q?: string;
  city?: string;
  limit?: number;
}

export interface CafeWithExternalIds extends CafeSummary {
  google_place_id: string | null;
  apple_poi_id: string | null;
}

const SEARCH_CAFES_SQL = `
select id, slug, name,
       ST_Y(location::geometry) as lat,
       ST_X(location::geometry) as lng,
       address, city, tz, opening_hours, price_range,
       google_place_id, apple_poi_id,
       work_stats, cover
from cafes
where deleted_at is null
  and ($1::text is null or $1::text = '' or name ilike '%' || $1 || '%' or to_tsvector('simple', name) @@ plainto_tsquery('simple', $1))
  and ($2::text is null or $2::text = '' or lower(city) = lower($2))
order by name asc
limit $3
`;

/**
 * Search own cafes in Postgres by keyword and city scope.
 */
export async function searchCafesInDb(
  params: SearchCafesDbParams,
): Promise<CafeWithExternalIds[]> {
  const q = params.q?.trim() || null;
  const city = params.city?.trim() || null;
  const limit = params.limit ?? appConfig.search.dbFetchCap;

  const { rows } = await query<CafeWithExternalIds & Record<string, unknown>>(
    SEARCH_CAFES_SQL,
    [q, city, limit],
  );

  return rows.map((row) => ({
    ...row,
    work_stats: coerceWorkStats(row.work_stats),
  }));
}
