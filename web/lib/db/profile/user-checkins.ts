import "server-only";

import { isValidUUID } from "@shared/uuid";
import { query } from "../postgres";
import { appConfig } from "@/lib/config";
import type { CheckInScores, MaxStay } from "@/types/checkins";
import type { StoredImage } from "@/types/images";
import { parseProfileCursor } from "./cursor";
import type { UserCheckInItemDto } from "./types";

type UserCheckInRow = {
  id: string;
  cafe_id: string;
  cafe_name: string;
  cafe_city: string;
  cafe_is_deleted: boolean;
  visited_at: Date;
  // Microsecond-precision rendering for the keyset cursor: `pg` parses
  // timestamptz into a JS Date (ms precision) but Postgres stores µs, so a
  // cursor built from the Date could sit BELOW the stored value and skip
  // rows sharing a millisecond (same fix as feed.ts CURSOR_TS).
  cursor_visited_at: string;
  scores: CheckInScores | null;
  max_stay: MaxStay | null;
  likes_count: number;
  notes: string | null;
  photos: StoredImage[] | null;
  is_creation: boolean;
};

function toUserCheckInItems(rows: UserCheckInRow[]): UserCheckInItemDto[] {
  return rows.map((r) => ({
    id: r.id,
    cafe_id: r.cafe_id,
    cafe_name: r.cafe_name,
    cafe_city: r.cafe_city,
    cafe_is_deleted: Boolean(r.cafe_is_deleted),
    visited_at: r.visited_at.toISOString(),
    scores: r.scores ?? {},
    max_stay: r.max_stay ?? null,
    likes_count: Number(r.likes_count ?? 0),
    notes: r.notes,
    photos: Array.isArray(r.photos) ? r.photos : [],
    is_creation: Boolean(r.is_creation),
  }));
}

/**
 * List user check-ins (My Check-ins tab), newest visited_at first.
 * Soft-deleted cafes still appear with cafeIsDeleted=true per DG99.
 */
export async function getUserCheckIns(
  userId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<{ items: UserCheckInItemDto[]; next_cursor: string | null }> {
  if (!isValidUUID(userId)) {
    return { items: [], next_cursor: null };
  }

  const limit = Math.max(
    1,
    Math.min(appConfig.profile.listLimitMax, options.limit ?? appConfig.profile.listPageSize),
  );
  const params: unknown[] = [userId, limit + 1];
  let cursorClause = "";

  if (options.cursor) {
    const { visitedAt: cursorVisitedAt, id: cursorId } = parseProfileCursor(options.cursor);
    params.push(cursorVisitedAt, cursorId);
    cursorClause = `and (ch.visited_at, ch.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }

  const result = await query<UserCheckInRow>(
    `
    select
      ch.id,
      ch.cafe_id,
      coalesce(c.name, '') as cafe_name,
      coalesce(c.city, '') as cafe_city,
      (c.id is null or c.deleted_at is not null) as cafe_is_deleted,
      ch.visited_at,
      to_char(ch.visited_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_visited_at,
      ch.scores,
      ch.max_stay,
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
  const items = toUserCheckInItems(rawItems);

  const last = rawItems[rawItems.length - 1];
  const next_cursor =
    hasMore && last ? `${last.cursor_visited_at}_${last.id}` : null;

  return { items, next_cursor };
}
