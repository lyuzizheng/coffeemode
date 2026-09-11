import "server-only";

import { isValidUUID } from "@shared/uuid";
import { query } from "../postgres";
import { appConfig } from "@/lib/config";
import { parseProfileCursor } from "./cursor";
import type { UserCafeItemDto } from "./types";

type UserCafeRow = {
  id: string;
  name: string;
  city: string;
  cover: string | null;
  last_visited_at: Date;
  checkins_count: string | number;
  is_creation: boolean;
};

function toUserCafeItems(rows: UserCafeRow[]): UserCafeItemDto[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    cover: r.cover,
    lastVisitedAt: r.last_visited_at.toISOString(),
    checkinsCount: Number(r.checkins_count ?? 0),
    isCreation: Boolean(r.is_creation),
  }));
}

/**
 * List distinct cafes visited by the user ("我的咖啡地图"), ordered by latest visited_at DESC.
 * Soft-deleted cafes are excluded entirely per DG99.
 */
export async function getUserCafes(
  userId: string,
  options: { limit?: number; cursor?: string; viewerId?: string | null } = {},
): Promise<{ items: UserCafeItemDto[]; nextCursor: string | null }> {
  if (!isValidUUID(userId)) {
    return { items: [], nextCursor: null };
  }

  const limit = Math.max(
    1,
    Math.min(appConfig.profile.listLimitMax, options.limit ?? appConfig.profile.listPageSize),
  );
  const params: unknown[] = [userId, limit + 1];
  const hasViewer = Boolean(options.viewerId && isValidUUID(options.viewerId));
  let visibilityClause = "and c.visibility = 'public'";
  if (hasViewer) {
    params.push(options.viewerId);
    visibilityClause = `and (c.visibility = 'public' or c.created_by = $${params.length})`;
  }

  let cursorClause = "";
  if (options.cursor) {
    const { visitedAt: cursorVisitedAt, id: cursorId } = parseProfileCursor(options.cursor);
    params.push(cursorVisitedAt, cursorId);
    cursorClause = `having (max(ch.visited_at), c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  const result = await query<UserCafeRow>(
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
      ${visibilityClause}
    group by c.id, c.name, c.city, c.cover
    ${cursorClause}
    order by last_visited_at desc, c.id desc
    limit $2
    `,
    params,
  );

  const hasMore = result.rows.length > limit;
  const rawItems = hasMore ? result.rows.slice(0, limit) : result.rows;
  const items = toUserCafeItems(rawItems);

  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? `${last.lastVisitedAt}_${last.id}` : null;

  return { items, nextCursor };
}
