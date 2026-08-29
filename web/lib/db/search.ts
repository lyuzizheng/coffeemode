import "server-only";

import { appConfig } from "@/lib/config";
import { coerceWorkStats } from "@/lib/stats/work-stats";
import type { CafeSummary } from "@/types/cafes";
import type { MaxStay } from "@/types/checkins";
import { query } from "./postgres";

export interface SearchCafesDbParams {
  q?: string;
  city?: string;
  filter_wifi?: number;
  filter_outlets?: number;
  filter_seats?: number;
  filter_temp?: number;
  filter_coffee?: number;
  filter_overall?: number;
  filter_max_stay?: MaxStay;
  offset?: number;
  limit?: number;
}

export interface CafeWithExternalIds extends CafeSummary {
  google_place_id: string | null;
  apple_poi_id: string | null;
}

const WORK_DIM_COLS = [
  { key: "filter_wifi", dim: "wifi" },
  { key: "filter_outlets", dim: "outlets" },
  { key: "filter_seats", dim: "seats" },
  { key: "filter_temp", dim: "temp" },
  { key: "filter_coffee", dim: "coffee" },
] as const;

export const ACCEPTABLE_MAX_STAYS: Record<MaxStay, string[]> = {
  peak: ["peak"],
  "1h": ["1h", "2h", "3h", "unlimited"],
  "2h": ["2h", "3h", "unlimited"],
  "3h": ["3h", "unlimited"],
  unlimited: ["unlimited"],
  unknown: ["unknown", "peak", "1h", "2h", "3h", "unlimited"],
};

/**
 * Search own cafes in Postgres by keyword, city scope, and work filters.
 * Structured nomad filters are pushed down into SQL so matching cafes are
 * not truncated by the alphabetical order LIMIT clause.
 */
export async function searchCafesInDb(
  params: SearchCafesDbParams,
): Promise<CafeWithExternalIds[]> {
  const q = params.q?.trim() || null;
  const city = params.city?.trim() || null;
  const limit = params.limit ?? appConfig.search.dbFetchCap;

  const conditions: string[] = ["deleted_at is null"];
  const values: unknown[] = [];

  values.push(q);
  const qIdx = values.length;
  conditions.push(
    `($${qIdx}::text is null or $${qIdx}::text = '' or name ilike '%' || $${qIdx} || '%' or to_tsvector('simple', name) @@ plainto_tsquery('simple', $${qIdx}))`,
  );

  values.push(city);
  const cityIdx = values.length;
  conditions.push(`($${cityIdx}::text is null or $${cityIdx}::text = '' or lower(city) = lower($${cityIdx}))`);

  for (const { key, dim } of WORK_DIM_COLS) {
    const val = params[key];
    if (val !== undefined) {
      values.push(val);
      const idx = values.length;
      conditions.push(
        `((work_stats->'dims'->'${dim}'->>'n')::numeric > 0 and ((work_stats->'dims'->'${dim}'->>'sum')::numeric / (work_stats->'dims'->'${dim}'->>'n')::numeric) >= $${idx})`,
      );
    }
  }

  if (params.filter_overall !== undefined) {
    values.push(params.filter_overall);
    const idx = values.length;
    conditions.push(
      `(case when work_stats->>'experience_score' is not null then (work_stats->>'experience_score')::numeric >= $${idx} when (work_stats->'dims'->'overall'->>'n')::numeric > 0 then ((work_stats->'dims'->'overall'->>'sum')::numeric / (work_stats->'dims'->'overall'->>'n')::numeric) >= $${idx} else false end)`,
    );
  }

  if (params.filter_max_stay !== undefined) {
    const allowed = ACCEPTABLE_MAX_STAYS[params.filter_max_stay];
    if (allowed) {
      values.push(allowed);
      const idx = values.length;
      conditions.push(
        `(select key from jsonb_each_text(case when jsonb_typeof(work_stats->'policies'->'max_stay') = 'object' then work_stats->'policies'->'max_stay' else '{}'::jsonb end) where value ~ '^[0-9]+$' and value::int > 0 order by value::int desc, key asc limit 1) = ANY($${idx}::text[])`,
      );
    }
  }

  values.push(limit);
  const limitIdx = values.length;

  let offsetClause = "";
  if (params.offset !== undefined && params.offset > 0) {
    values.push(params.offset);
    const offsetIdx = values.length;
    offsetClause = `\noffset $${offsetIdx}`;
  }

  const sql = `
select id, name,
       ST_Y(location::geometry) as lat,
       ST_X(location::geometry) as lng,
       address, city, tz, opening_hours, price_range,
       google_place_id, apple_poi_id,
       work_stats, cover
from cafes
where ${conditions.join("\n  and ")}
order by name asc, id asc
limit $${limitIdx}${offsetClause}
`;

  const { rows } = await query<CafeWithExternalIds & Record<string, unknown>>(
    sql,
    values,
  );

  return rows.map((row) => ({
    ...row,
    work_stats: coerceWorkStats(row.work_stats),
  }));
}
