import "server-only";

import { query } from "@/lib/db/postgres";
import { appConfig } from "@/lib/config";
import { isValidUUID } from "@shared/uuid";
import type {
  CheckInFeedMode,
  CheckInFeedPage,
  PublicCheckIn,
} from "@/types/checkins";
import type { StoredImage } from "@/types/images";

/**
 * Public cafe check-in feed (discovery-sheet, spec 0001).
 *
 * Unauthenticated, paginated by server-issued, mode-bound opaque cursors —
 * never offset. Newest orders by `visited_at DESC, id DESC`; Helpful by
 * `likes_count DESC, visited_at DESC, id DESC`. Each cursor carries its mode
 * and the last row's full ordering tuple (keyset pagination). Likes may move
 * a row between requests, so pagination is best-effort and clients
 * deduplicate by check-in id.
 */

export const FEED_MODES = ["newest", "helpful"] as const;

export class FeedCursorError extends Error {
  constructor(message = "invalid cursor") {
    super(message);
    this.name = "FeedCursorError";
  }
}

interface FeedCursorPayload {
  v: 1;
  mode: CheckInFeedMode;
  likes?: number;
  visited_at: string;
  id: string;
}

export function encodeFeedCursor(payload: FeedCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decode and validate a cursor; it must have been issued for the same mode. */
export function decodeFeedCursor(raw: string, mode: CheckInFeedMode): FeedCursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new FeedCursorError();
  }
  const p = parsed as Partial<FeedCursorPayload> | null;
  if (
    p === null ||
    typeof p !== "object" ||
    p.v !== 1 ||
    p.mode !== mode ||
    typeof p.visited_at !== "string" ||
    Number.isNaN(Date.parse(p.visited_at)) ||
    typeof p.id !== "string" ||
    !isValidUUID(p.id) ||
    (mode === "helpful" && (typeof p.likes !== "number" || !Number.isInteger(p.likes) || p.likes < 0))
  ) {
    throw new FeedCursorError();
  }
  return p as FeedCursorPayload;
}

interface FeedRow {
  id: string;
  scores: PublicCheckIn["scores"];
  min_spend: PublicCheckIn["min_spend"];
  max_stay: PublicCheckIn["max_stay"];
  note: string | null;
  photos: StoredImage[] | null;
  likes_count: number;
  visited_at: string;
  liked_by_viewer: boolean | null;
  /** Microsecond-precision UTC rendering used only for cursor round-trips. */
  cursor_visited_at: string;
}

// `pg` parses timestamptz into a JS Date (millisecond precision). Postgres
// stores microseconds, so a cursor built from the Date could sit BELOW the
// real stored value and silently skip rows that share the same millisecond.
// The cursor therefore round-trips a microsecond-precision text rendering
// produced by Postgres itself; the DTO keeps the plain Date.
const CURSOR_TS = `to_char(c.visited_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const NEWEST_SQL = `
select c.id, c.scores, c.min_spend, c.max_stay, c.note, c.photos, c.likes_count, c.visited_at,
       (cl.user_id is not null) as liked_by_viewer,
       ${CURSOR_TS} as cursor_visited_at
from checkins c
left join checkin_likes cl
  on cl.checkin_id = c.id and cl.user_id = $2
where c.cafe_id = $1 and c.deleted_at is null
  and ($3::timestamptz is null or (c.visited_at, c.id) < ($3::timestamptz, $4::uuid))
order by c.visited_at desc, c.id desc
limit $5
`;

const HELPFUL_SQL = `
select c.id, c.scores, c.min_spend, c.max_stay, c.note, c.photos, c.likes_count, c.visited_at,
       (cl.user_id is not null) as liked_by_viewer,
       ${CURSOR_TS} as cursor_visited_at
from checkins c
left join checkin_likes cl
  on cl.checkin_id = c.id and cl.user_id = $2
where c.cafe_id = $1 and c.deleted_at is null
  and (
    $3::int is null
    or (c.likes_count, c.visited_at, c.id) < ($3::int, $4::timestamptz, $5::uuid)
  )
order by c.likes_count desc, c.visited_at desc, c.id desc
limit $6
`;

/**
 * One page of non-deleted public check-ins for a cafe. `viewerId` is null
 * for anonymous sessions — `liked_by_viewer` is then false for every row.
 */
export async function listPublicCheckIns(params: {
  cafeId: string;
  mode: CheckInFeedMode;
  cursor?: string;
  viewerId: string | null;
}): Promise<CheckInFeedPage> {
  const { cafeId, mode, viewerId } = params;
  const pageSize = appConfig.feed.pageSize;
  const cursor = params.cursor ? decodeFeedCursor(params.cursor, mode) : null;

  const { rows } =
    mode === "newest"
      ? await query<FeedRow & Record<string, unknown>>(NEWEST_SQL, [
          cafeId,
          viewerId,
          cursor?.visited_at ?? null,
          cursor?.id ?? null,
          pageSize + 1,
        ])
      : await query<FeedRow & Record<string, unknown>>(HELPFUL_SQL, [
          cafeId,
          viewerId,
          cursor?.likes ?? null,
          cursor?.visited_at ?? null,
          cursor?.id ?? null,
          pageSize + 1,
        ]);

  const pageRows = rows.slice(0, pageSize);
  const checkins: PublicCheckIn[] = pageRows.map((row) => ({
    id: row.id,
    scores: row.scores,
    min_spend: row.min_spend,
    max_stay: row.max_stay,
    note: row.note,
    // Public DTO: strip the internal author id from every photo (spec 0001).
    photos: (row.photos ?? []).map(({ by: _by, ...image }) => image),
    likes_count: row.likes_count,
    liked_by_viewer: viewerId !== null && row.liked_by_viewer === true,
    visited_at: row.visited_at,
  }));

  let nextCursor: string | null = null;
  if (rows.length > pageSize && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = encodeFeedCursor({
      v: 1,
      mode,
      likes: mode === "helpful" ? last.likes_count : undefined,
      visited_at: last.cursor_visited_at,
      id: last.id,
    });
  }
  return { checkins, nextCursor };
}
