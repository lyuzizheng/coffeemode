import "server-only";

import { appConfig } from "@/lib/config";
import { isValidUUID } from "@shared/uuid";
import type {
  CheckInFeedMode,
  CheckInFeedPage,
  PublicCheckIn,
} from "@/types/checkins";
import { toPublicAuthor } from "@/types/identity";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  FeedCursorError,
  FeedCursorExpiredError,
  type FeedCursorPayload,
} from "@/lib/discovery/feed-cursor";
import {
  queryHelpfulFeedPage,
  queryNewestFeedPage,
  type FeedRowResult,
} from "@/lib/db/checkins/feed";

/**
 * Public cafe check-in feed (discovery-sheet, spec 0001).
 *
 * Unauthenticated page orchestration over the cursor leaf
 * (`lib/discovery/feed-cursor`) and the DB feed reads
 * (`lib/db/checkins/feed`): decode the mode-bound cursor, fetch one
 * over-fetched page, project rows to the public DTO, and issue the
 * next-page cursor. Likes may move a row between requests, so pagination
 * is best-effort and clients deduplicate by check-in id.
 */

export const FEED_MODES = ["newest", "helpful"] as const;

// Re-exported so existing callers keep one import site; the domain-error
// mapper consumes the leaf directly (BRAWUKA-749, no SQL-owning import).
export {
  decodeFeedCursor,
  encodeFeedCursor,
  FeedCursorError,
  FeedCursorExpiredError,
};
export type { FeedCursorPayload };

/** Next-page cursor for the row a page ended on (v2 while a snapshot serves). */
function encodeNextCursor(
  mode: CheckInFeedMode,
  runId: string | null,
  last: FeedRowResult,
): string {
  if (mode === "helpful" && runId !== null) {
    return encodeFeedCursor({
      v: 2,
      mode: "helpful",
      run: runId,
      score: last.snapshot_score ?? 0,
      visited_at: last.cursor_visited_at,
      id: last.id,
    });
  }
  return encodeFeedCursor({
    v: 1,
    mode,
    likes: mode === "helpful" ? last.likes_count : undefined,
    visited_at: last.cursor_visited_at,
    id: last.id,
  });
}

/**
 * One page of non-deleted public check-ins for a cafe. `viewerId` is null
 * for anonymous sessions — `liked_by_viewer` and `owned_by_viewer` are then
 * false for every row.
 */
export async function listPublicCheckIns(params: {
  cafeId: string;
  mode: CheckInFeedMode;
  cursor?: string;
  viewerId: string | null;
}): Promise<CheckInFeedPage> {
  const { cafeId, mode, viewerId } = params;
  if (!isValidUUID(cafeId)) {
    return { checkins: [], next_cursor: null };
  }
  const pageSize = appConfig.feed.pageSize;
  const cursor: FeedCursorPayload | null = params.cursor
    ? decodeFeedCursor(params.cursor, mode)
    : null;

  let rows: FeedRowResult[];
  let helpfulRunId: string | null = null;
  if (mode === "newest") {
    rows = await queryNewestFeedPage(cafeId, viewerId, cursor, pageSize);
  } else {
    ({ rows, runId: helpfulRunId } = await queryHelpfulFeedPage(cafeId, viewerId, cursor, pageSize));
  }

  const pageRows = rows.slice(0, pageSize);
  const checkins: PublicCheckIn[] = pageRows.map((row) => ({
    id: row.id,
    scores: row.scores,
    max_stay: row.max_stay,
    note: row.note,
    // Public DTO: strip the internal author id from every photo (spec 0001).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip internal author id (DG13)
    photos: (row.photos ?? []).map(({ by: _by, ...image }) => image),
    likes_count: row.likes_count,
    liked_by_viewer: viewerId !== null && row.liked_by_viewer === true,
    owned_by_viewer: viewerId !== null && row.owned_by_viewer === true,
    visited_at: row.visited_at,
    // Display-only leaf (spec 0006 Q9): null renders the "a_nomad" fallback.
    author: toPublicAuthor(row),
  }));

  let next_cursor: string | null = null;
  if (rows.length > pageSize && pageRows.length > 0) {
    next_cursor = encodeNextCursor(mode, helpfulRunId, pageRows[pageRows.length - 1]);
  }
  return { checkins, next_cursor };
}
