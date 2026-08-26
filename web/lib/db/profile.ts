import "server-only";

import { isValidUUID } from "@shared/uuid";
import { query } from "./postgres";
import type { CheckInScores } from "@/types/checkins";
import type { StoredImage } from "@/types/images";

export interface UserProfileDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  currentCity: string;
  createdAt: string;
}

export interface UserProfileStatsDto {
  cafesCount: number;
  checkinsCount: number;
}

export interface UserCheckInItemDto {
  id: string;
  cafeId: string;
  cafeName: string;
  cafeCity: string;
  cafeIsDeleted: boolean;
  visitedAt: string;
  scores: CheckInScores;
  likesCount: number;
  notes: string | null;
  photos: StoredImage[];
  isCreation: boolean;
}

export interface UserCafeItemDto {
  id: string;
  name: string;
  city: string;
  cover: string | null;
  lastVisitedAt: string;
  checkinsCount: number;
  isCreation: boolean;
}

/** Get the profile record for a user. */
export async function getProfile(userId: string): Promise<UserProfileDto | null> {
  if (!isValidUUID(userId)) return null;

  const result = await query<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    current_city: string;
    created_at: Date;
  }>(
    `
    select id, display_name, avatar_url, coalesce(current_city, 'singapore') as current_city, created_at
    from profiles
    where id = $1
    `,
    [userId],
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    currentCity: row.current_city,
    createdAt: row.created_at.toISOString(),
  };
}

/** Get user's distinct cafe count and total check-in count. */
export async function getUserStats(userId: string): Promise<UserProfileStatsDto> {
  if (!isValidUUID(userId)) {
    return { cafesCount: 0, checkinsCount: 0 };
  }

  const result = await query<{
    cafes_count: string | number;
    checkins_count: string | number;
  }>(
    `
    select
      count(distinct ch.cafe_id) filter (where ch.deleted_at is null and c.deleted_at is null) as cafes_count,
      count(ch.id) filter (where ch.deleted_at is null) as checkins_count
    from checkins ch
    left join cafes c on c.id = ch.cafe_id
    where ch.user_id = $1
    `,
    [userId],
  );

  const row = result.rows[0];
  return {
    cafesCount: Number(row?.cafes_count ?? 0),
    checkinsCount: Number(row?.checkins_count ?? 0),
  };
}

/** Update user profile display name or current city. */
export async function updateProfile(
  userId: string,
  patch: { displayName?: string; currentCity?: string },
): Promise<UserProfileDto | null> {
  if (!isValidUUID(userId)) return null;

  const updates: string[] = [];
  const params: unknown[] = [userId];

  if (patch.displayName !== undefined) {
    const trimmed = patch.displayName.trim();
    if (trimmed.length > 0 && trimmed.length <= 24) {
      params.push(trimmed);
      updates.push(`display_name = $${params.length}`);
    }
  }

  if (patch.currentCity !== undefined) {
    const trimmedCity = patch.currentCity.trim().toLowerCase();
    if (trimmedCity.length > 0 && trimmedCity.length <= 50) {
      params.push(trimmedCity);
      updates.push(`current_city = $${params.length}`);
    }
  }

  if (updates.length === 0) {
    return getProfile(userId);
  }

  const result = await query<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    current_city: string;
    created_at: Date;
  }>(
    `
    update profiles
    set ${updates.join(", ")}, last_seen_at = now()
    where id = $1
    returning id, display_name, avatar_url, coalesce(current_city, 'singapore') as current_city, created_at
    `,
    params,
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    currentCity: row.current_city,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * List user check-ins (My Check-ins tab), newest visited_at first.
 * Soft-deleted cafes still appear with cafeIsDeleted=true per DG99.
 */
export async function getUserCheckIns(
  userId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<{ items: UserCheckInItemDto[]; nextCursor: string | null }> {
  if (!isValidUUID(userId)) {
    return { items: [], nextCursor: null };
  }

  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const params: unknown[] = [userId, limit + 1];
  let cursorClause = "";

  if (options.cursor) {
    const [cursorVisitedAt, cursorId] = options.cursor.split("_");
    if (
      cursorVisitedAt &&
      cursorId &&
      isValidUUID(cursorId) &&
      !Number.isNaN(Date.parse(cursorVisitedAt))
    ) {
      params.push(cursorVisitedAt, cursorId);
      cursorClause = `and (ch.visited_at, ch.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
  }

  const result = await query<{
    id: string;
    cafe_id: string;
    cafe_name: string;
    cafe_city: string;
    cafe_is_deleted: boolean;
    visited_at: Date;
    scores: CheckInScores | null;
    likes_count: number;
    notes: string | null;
    photos: StoredImage[] | null;
    is_creation: boolean;
  }>(
    `
    select
      ch.id,
      ch.cafe_id,
      coalesce(c.name, 'Unknown cafe') as cafe_name,
      coalesce(c.city, 'singapore') as cafe_city,
      (c.id is null or c.deleted_at is not null) as cafe_is_deleted,
      ch.visited_at,
      ch.scores,
      ch.likes_count,
      ch.note as notes,
      ch.photos,
      ch.is_creation
    from checkins ch
    left join cafes c on c.id = ch.cafe_id
    where ch.user_id = $1
      and ch.deleted_at is null
      ${cursorClause}
    order by ch.visited_at desc, ch.id desc
    limit $2
    `,
    params,
  );

  const hasMore = result.rows.length > limit;
  const rawItems = hasMore ? result.rows.slice(0, limit) : result.rows;

  const items: UserCheckInItemDto[] = rawItems.map((r) => ({
    id: r.id,
    cafeId: r.cafe_id,
    cafeName: r.cafe_name,
    cafeCity: r.cafe_city,
    cafeIsDeleted: Boolean(r.cafe_is_deleted),
    visitedAt: r.visited_at.toISOString(),
    scores: r.scores ?? {},
    likesCount: Number(r.likes_count ?? 0),
    notes: r.notes,
    photos: Array.isArray(r.photos) ? r.photos : [],
    isCreation: Boolean(r.is_creation),
  }));

  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? `${last.visitedAt}_${last.id}` : null;

  return { items, nextCursor };
}

/**
 * List distinct cafes visited by the user ("我的咖啡地图"), ordered by latest visited_at DESC.
 * Soft-deleted cafes are excluded entirely per DG99.
 */
export async function getUserCafes(
  userId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<{ items: UserCafeItemDto[]; nextCursor: string | null }> {
  if (!isValidUUID(userId)) {
    return { items: [], nextCursor: null };
  }

  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const params: unknown[] = [userId, limit + 1];
  let cursorClause = "";

  if (options.cursor) {
    const [cursorVisitedAt, cursorId] = options.cursor.split("_");
    if (
      cursorVisitedAt &&
      cursorId &&
      isValidUUID(cursorId) &&
      !Number.isNaN(Date.parse(cursorVisitedAt))
    ) {
      params.push(cursorVisitedAt, cursorId);
      cursorClause = `having (max(ch.visited_at), c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
  }

  const result = await query<{
    id: string;
    name: string;
    city: string;
    cover: string | null;
    last_visited_at: Date;
    checkins_count: string | number;
    is_creation: boolean;
  }>(
    `
    select
      c.id,
      c.name,
      c.city,
      c.cover,
      max(ch.visited_at) as last_visited_at,
      count(ch.id) as checkins_count,
      bool_or(c.created_by = $1 or ch.is_creation = true) as is_creation
    from checkins ch
    join cafes c on c.id = ch.cafe_id and c.deleted_at is null
    where ch.user_id = $1
      and ch.deleted_at is null
    group by c.id, c.name, c.city, c.cover
    ${cursorClause}
    order by last_visited_at desc, c.id desc
    limit $2
    `,
    params,
  );

  const hasMore = result.rows.length > limit;
  const rawItems = hasMore ? result.rows.slice(0, limit) : result.rows;

  const items: UserCafeItemDto[] = rawItems.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    cover: r.cover,
    lastVisitedAt: r.last_visited_at.toISOString(),
    checkinsCount: Number(r.checkins_count ?? 0),
    isCreation: Boolean(r.is_creation),
  }));

  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? `${last.lastVisitedAt}_${last.id}` : null;

  return { items, nextCursor };
}
