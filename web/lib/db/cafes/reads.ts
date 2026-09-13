import "server-only";

import { isValidUUID } from "@shared/uuid";
import { coerceWorkStats } from "@/lib/stats/work-stats";
import { appConfig } from "@/lib/config";
import type {
  CafeDetail,
  CafeSummary,
  CafeVisibility,
  PublicCafeDetail,
} from "@/types/cafes";
import { toPublicAuthor, type AuthorProjectionColumns } from "@/types/identity";
import { query } from "../postgres";
import { isServiceMaintained } from "./meta";

export interface NearbyCafesQuery {
  lat: number;
  lng: number;
  radiusKm: number;
  limit: number;
  viewerId?: string | null;
}

const LIST_NEARBY_PUBLIC_SQL = `
select id, name,
       ST_Y(location::geometry) as lat,
       ST_X(location::geometry) as lng,
       address, city, tz, opening_hours, price_range, work_stats, cover,
       created_by, visibility,
       (location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_m
from cafes
where deleted_at is null
  and visibility = 'public'
  and ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3::float8 * 1000)
order by distance_m asc
limit $4
`;

const LIST_NEARBY_VIEWER_SQL = `
select id, name,
       ST_Y(location::geometry) as lat,
       ST_X(location::geometry) as lng,
       address, city, tz, opening_hours, price_range, work_stats, cover,
       created_by, visibility,
       (location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_m
from cafes
where deleted_at is null
  and (visibility = 'public' or created_by = $5)
  and ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3::float8 * 1000)
order by distance_m asc
limit $4
`;

/** Nearby cafes within `radiusKm` of a point, closest first. */
export async function listCafesNearby(params: NearbyCafesQuery): Promise<CafeSummary[]> {
  const hasViewer = Boolean(params.viewerId && isValidUUID(params.viewerId));
  const sql = hasViewer ? LIST_NEARBY_VIEWER_SQL : LIST_NEARBY_PUBLIC_SQL;
  const values = hasViewer
    ? [params.lat, params.lng, params.radiusKm, params.limit, params.viewerId]
    : [params.lat, params.lng, params.radiusKm, params.limit];

  const { rows } = await query<
    CafeSummary & { created_by?: string | null; distance_m: number } & Record<string, unknown>
  >(sql, values);
  return rows.map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip internal creator id (spec 0001 / DG13)
    const { created_by: _cb, ...rest } = row;
    return {
      ...rest,
      maintained_by_service: isServiceMaintained(row.created_by),
      work_stats: coerceWorkStats(row.work_stats, appConfig.stats.dimWeights),
    };
  });
}

const GET_BY_ID_SQL = `
select c.id, c.name,
       ST_Y(c.location::geometry) as lat,
       ST_X(c.location::geometry) as lng,
       c.address, c.city, c.description, c.cover, c.gallery, c.opening_hours, c.tz,
       c.price_range, c.google_place_id, c.apple_poi_id, c.work_stats,
       c.created_by, c.visibility,
       c.created_at, c.updated_at,
       case when p.show_public_identity then p.public_handle end as author_handle,
       case when p.show_public_identity then p.display_name end as author_display_name,
       case when p.show_public_identity then p.avatar_url end as author_avatar_url
from cafes c
left join profiles p on p.id = c.created_by
where c.id = $1 and c.deleted_at is null
`;

/** Internal cafe row plus its public-safe author projection columns. */
export type CafeDetailWithAuthor = CafeDetail & Partial<AuthorProjectionColumns>;

/** Single cafe by id; null when missing, soft-deleted, or private to non-creator (404). */
export async function getCafe(
  id: string,
  viewerId?: string | null,
): Promise<CafeDetailWithAuthor | null> {
  if (!isValidUUID(id)) throw new Error("Invalid cafe ID");
  const { rows } = await query<
    CafeDetail & { created_by: string | null; visibility: CafeVisibility } & Record<string, unknown>
  >(GET_BY_ID_SQL, [id]);
  const row = rows[0];
  if (!row) return null;

  // Private is a read-path filter: private + viewer != creator -> 404 (null)
  if (row.visibility === "private") {
    if (!viewerId || !isValidUUID(viewerId) || row.created_by !== viewerId) {
      return null;
    }
  }

  return {
    ...row,
    gallery: row.gallery ?? [],
    work_stats: coerceWorkStats(row.work_stats, appConfig.stats.dimWeights),
  };
}

/**
 * Public cafe detail projection (spec 0001 DG13): strip creator id and `StoredImage.by`
 * from gallery so the anonymous surface never leaks internal author ids.
 * Null created_by falls back to the service account: `maintained_by_service`
 * is true and the client renders the localized maintainer line.
 * Author (spec 0006) is the consented creator projection; always null on the
 * anonymous / service-account / null-`created_by` path (architect correction).
 */
export function toPublicCafeDetail(cafe: CafeDetailWithAuthor): PublicCafeDetail {
  const serviceMaintained = isServiceMaintained(cafe.created_by);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip internal creator id + raw author columns (spec 0001 / DG13)
  const { created_by: _cb, gallery, author_handle: _ah, author_display_name: _an, author_avatar_url: _aa, ...rest } = cafe;
  return {
    ...rest,
    maintained_by_service: serviceMaintained,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip internal author id (DG13)
    gallery: (gallery ?? []).map(({ by: _by, ...image }) => image),
    author: serviceMaintained ? null : toPublicAuthor(cafe),
  };
}

export interface CafeSitemapEntry {
  id: string;
  /** ISO timestamp. */
  lastmod: string;
}

const LIST_SITEMAP_SQL = `
select id,
       coalesce((work_stats->>'updated_at')::timestamptz, updated_at) as lastmod
from cafes
where deleted_at is null
  and visibility = 'public'
  and ((work_stats->>'n_checkins') is null or (work_stats->>'n_checkins')::int > 0)
order by lastmod desc
`;

/**
 * All live cafes for sitemap.xml. lastmod prefers work_stats.updated_at per
 * DG105 (the aggregate is what actually changes when check-ins land) and
 * falls back to the row's updated_at for cafes whose stats predate the field.
 */
export async function listCafeSitemapEntries(): Promise<CafeSitemapEntry[]> {
  const { rows } = await query<{ id: string; lastmod: Date } & Record<string, unknown>>(
    LIST_SITEMAP_SQL,
  );
  return rows.map((row) => ({
    id: row.id,
    lastmod: new Date(row.lastmod).toISOString(),
  }));
}

const GET_LOCATION_SQL = `
select ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng
from cafes
where id = $1
`;

const EXISTS_PUBLIC_SQL = `select 1 from cafes where id = $1 and deleted_at is null and visibility = 'public'`;
const EXISTS_VIEWER_SQL = `select 1 from cafes where id = $1 and deleted_at is null and (visibility = 'public' or created_by = $2)`;
const EXISTS_LIVE_SQL = `select 1 from cafes where id = $1 and deleted_at is null`;

/** Live-only probe: true when the cafe exists and is not soft-deleted (tombstoned). */
export async function isLiveCafe(id: string): Promise<boolean> {
  if (!isValidUUID(id)) return false;
  const { rows } = await query<Record<string, unknown>>(EXISTS_LIVE_SQL, [id]);
  return rows.length > 0;
}

/**
 * Existence probe for the gone-cafe 404 path: the proxy checks this BEFORE
 * the page streams so a missing cafe gets a real 404 status (DG19) instead
 * of a streamed soft-404. Private cafes are 404 for non-owners.
 */
export async function cafeExists(id: string, viewerId?: string | null): Promise<boolean> {
  if (!isValidUUID(id)) return false;
  if (viewerId && isValidUUID(viewerId)) {
    const { rows } = await query<Record<string, unknown>>(EXISTS_VIEWER_SQL, [id, viewerId]);
    return rows.length > 0;
  }
  const { rows } = await query<Record<string, unknown>>(EXISTS_PUBLIC_SQL, [id]);
  return rows.length > 0;
}

/**
 * A cafe's coordinates when the row still exists (including soft-deleted cafes).
 * Unlike getCafe this tolerates invalid ids (returns null) because its caller is the 404
 * recovery path (DG111), where a malformed id is a normal case. The kept tombstone row
 * allows recovery suggestions to find nearby alternatives.
 */
export async function getCafeLocation(
  id: string,
): Promise<{ lat: number; lng: number } | null> {
  if (!isValidUUID(id)) return null;
  const { rows } = await query<{ lat: number; lng: number } & Record<string, unknown>>(
    GET_LOCATION_SQL,
    [id],
  );
  const row = rows[0];
  return row ? { lat: row.lat, lng: row.lng } : null;
}
