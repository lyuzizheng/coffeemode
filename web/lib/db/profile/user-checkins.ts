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
    cafeId: r.cafe_id,
    cafeName: r.cafe_name,
    cafeCity: r.cafe_city,
    cafeIsDeleted: Boolean(r.cafe_is_deleted),
    visitedAt: r.visited_at.toISOString(),
    scores: r.scores ?? {},
    maxStay: r.max_stay ?? null,
    likesCount: Number(r.likes_count ?? 0),
    notes: r.notes,
    photos: Array.isArray(r.photos) ? r.photos : [],
    isCreation: Boolean(r.is_creation),
  }));
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

  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? `${last.visitedAt}_${last.id}` : null;

  return { items, nextCursor };
}
