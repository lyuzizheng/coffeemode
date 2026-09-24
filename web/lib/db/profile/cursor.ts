import "server-only";

import { isValidUUID } from "@shared/uuid";

export class ProfileCursorError extends Error {
  constructor(message = "invalid cursor") {
    super(message);
    this.name = "ProfileCursorError";
  }
}

export function parseProfileCursor(cursor: string): { visitedAt: string; id: string } {
  const parts = cursor.split("_");
  if (parts.length !== 2) {
    throw new ProfileCursorError();
  }
  const [cursorVisitedAt, cursorId] = parts;
  if (
    !cursorVisitedAt ||
    !cursorId ||
    !isValidUUID(cursorId) ||
    Number.isNaN(Date.parse(cursorVisitedAt))
  ) {
    throw new ProfileCursorError();
  }
  return { visitedAt: cursorVisitedAt, id: cursorId };
}

/**
 * Keyset-pagination tail shared by the profile list queries (OPT-2).
 *
 * Callers fetch `limit + 1` rows; the extra row is only a has-more probe.
 * Returns the page to render plus the `${cursor_visited_at}_${id}` cursor
 * for the next page, or null when exhausted. Cursor encoding is the exact
 * format `parseProfileCursor` decodes — keep both in this file.
 */
export function paginateProfileRows<T extends { cursor_visited_at: string; id: string }>(
  rows: T[],
  limit: number,
): { page: T[]; next_cursor: string | null } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const next_cursor = hasMore && last ? `${last.cursor_visited_at}_${last.id}` : null;
  return { page, next_cursor };
}
