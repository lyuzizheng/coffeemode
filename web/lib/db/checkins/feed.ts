import "server-only";

import type { PublicCheckIn } from "@/types/checkins";
import type { StoredImage } from "@/types/images";
import { query } from "../postgres";
import {
  FeedCursorExpiredError,
  type FeedCursorPayload,
} from "@/lib/discovery/feed-cursor";

/**
 * Check-in feed read path (BRAWUKA-749): SQL, row types, and the Helpful
 * snapshot query live here. Newest orders by `visited_at DESC, id DESC`;
 * Helpful by `likes_count DESC, visited_at DESC, id DESC` (v1 fallback) or
 * the frozen snapshot `(score, visited_at, checkin_id)` tuple (v2, DG148).
 *
 * This module depends only on the cursor leaf for input types — never on
 * the `lib/discovery` orchestration. Only the newest/helpful reads the
 * public feed needs are provided; no generic paginator or query DSL.
 */

export interface FeedRow {
  id: string;
  scores: PublicCheckIn["scores"];
  max_stay: PublicCheckIn["max_stay"];
  note: string | null;
  photos: StoredImage[] | null;
  likes_count: number;
  /** Frozen decay score — selected only on the snapshot read path (DG148). */
  snapshot_score: number | null;
  visited_at: string;
  liked_by_viewer: boolean | null;
  /**
   * Server-computed ownership bit (DG72): true only for the viewer's own
   * rows. A boolean comparison result — never the author's `user_id`
   * (DG13: FeedRow carries no internal UUID).
   */
  owned_by_viewer: boolean | null;
  /** Microsecond-precision UTC rendering used only for cursor round-trips. */
  cursor_visited_at: string;
  /**
   * Consented author columns (spec 0006 Q5/Q8): null unless the author's
   * profile has `show_public_identity`. The join key (`c.user_id`) is never
   * selected — FeedRow carries no internal UUID.
   */
  author_handle: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
}

export type FeedRowResult = FeedRow & Record<string, unknown>;

// `pg` parses timestamptz into a JS Date (millisecond precision). Postgres
// stores microseconds, so a cursor built from the Date could sit BELOW the
// real stored value and silently skip rows that share the same millisecond.
// The cursor therefore round-trips a microsecond-precision text rendering
// produced by Postgres itself; the DTO keeps the plain Date.
const CURSOR_TS = `to_char(c.visited_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const NEWEST_SQL = `
select c.id, c.scores, c.max_stay, c.note, c.photos, c.likes_count, c.visited_at,
       (cl.user_id is not null) as liked_by_viewer,
       (c.user_id = $2) as owned_by_viewer,
       ${CURSOR_TS} as cursor_visited_at,
       case when p.show_public_identity then p.public_handle end as author_handle,
       case when p.show_public_identity then p.display_name end as author_display_name,
       case when p.show_public_identity then p.avatar_url end as author_avatar_url
from checkins c
left join checkin_likes cl
  on cl.checkin_id = c.id and cl.user_id = $2
left join profiles p on p.id = c.user_id
where c.cafe_id = $1 and c.deleted_at is null
  and ($3::timestamptz is null or (c.visited_at, c.id) < ($3::timestamptz, $4::uuid))
order by c.visited_at desc, c.id desc
limit $5
`;

const HELPFUL_SQL = `
select c.id, c.scores, c.max_stay, c.note, c.photos, c.likes_count, c.visited_at,
       (cl.user_id is not null) as liked_by_viewer,
       (c.user_id = $2) as owned_by_viewer,
       ${CURSOR_TS} as cursor_visited_at,
       case when p.show_public_identity then p.public_handle end as author_handle,
       case when p.show_public_identity then p.display_name end as author_display_name,
       case when p.show_public_identity then p.avatar_url end as author_avatar_url
from checkins c
left join checkin_likes cl
  on cl.checkin_id = c.id and cl.user_id = $2
left join profiles p on p.id = c.user_id
where c.cafe_id = $1 and c.deleted_at is null
  and (
    $3::int is null
    or (c.likes_count, c.visited_at, c.id) < ($3::int, $4::timestamptz, $5::uuid)
  )
order by c.likes_count desc, c.visited_at desc, c.id desc
limit $6
`;

const CURSOR_TS_ENTRY = `to_char(e.visited_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Snapshot read path (DG148): order by the frozen `(score, visited_at,
 * checkin_id)` tuple within the active run, join `checkins` for the DTO,
 * and keep `deleted_at is null` live — the snapshot freezes order, not
 * visibility, so check-ins deleted after publication vanish from pages.
 * `likes_count` is the frozen snapshot value, so likes granted after
 * publication affect only the next snapshot.
 *
 * The active run rides along as `run_id` on every row (BRAWUKA-653): one
 * statement per page, no separate `helpful_ranking_runs` probe. An empty
 * page still returns one all-null sentinel row so the serving run id is
 * known for cursor validation; zero rows means no run is active.
 */
const HELPFUL_SNAPSHOT_SQL = `
with active_run as (
  select id from helpful_ranking_runs where status = 'active' limit 1
)
select r.id as run_id, page.*
from active_run r
left join lateral (
  select c.id, c.scores, c.max_stay, c.note, c.photos, e.likes_count, c.visited_at,
         e.score as snapshot_score,
         (cl.user_id is not null) as liked_by_viewer,
         (c.user_id = $1) as owned_by_viewer,
         ${CURSOR_TS_ENTRY} as cursor_visited_at,
         case when p.show_public_identity then p.public_handle end as author_handle,
         case when p.show_public_identity then p.display_name end as author_display_name,
         case when p.show_public_identity then p.avatar_url end as author_avatar_url
  from helpful_ranking_entries e
  join checkins c on c.id = e.checkin_id
  left join checkin_likes cl
    on cl.checkin_id = c.id and cl.user_id = $1
  left join profiles p on p.id = c.user_id
  where e.run_id = r.id and e.cafe_id = $2 and c.deleted_at is null
    and (
      $3::double precision is null
      or (e.score, e.visited_at, e.checkin_id) < ($3::double precision, $4::timestamptz, $5::uuid)
    )
  order by e.score desc, e.visited_at desc, e.checkin_id desc
  limit $6
) page on true
order by page.snapshot_score desc, page.cursor_visited_at desc, page.id desc
`;

/** One over-fetched Newest page (keyset on `(visited_at, id)`). */
export async function queryNewestFeedPage(
  cafeId: string,
  viewerId: string | null,
  cursor: FeedCursorPayload | null,
  pageSize: number,
): Promise<FeedRowResult[]> {
  const { rows } = await query<FeedRowResult>(NEWEST_SQL, [
    cafeId,
    viewerId,
    cursor?.visited_at ?? null,
    cursor?.id ?? null,
    pageSize + 1,
  ]);
  return rows;
}

/**
 * One over-fetched Helpful page plus the run that served it (null while no
 * snapshot is published — the live-tuple SQL stays the fallback ordering).
 * Stale-version cursors throw FeedCursorExpiredError (DG148).
 *
 * The snapshot statement answers the page and the active run id in one
 * round trip; only the pre-first-publish window pays a second query for
 * the live-ordering fallback.
 */
export async function queryHelpfulFeedPage(
  cafeId: string,
  viewerId: string | null,
  cursor: FeedCursorPayload | null,
  pageSize: number,
): Promise<{ rows: FeedRowResult[]; runId: string | null }> {
  const { rows: snapshotRows } = await query<FeedRowResult>(HELPFUL_SNAPSHOT_SQL, [
    viewerId,
    cafeId,
    cursor?.v === 2 ? cursor.score : null,
    cursor?.visited_at ?? null,
    cursor?.id ?? null,
    pageSize + 1,
  ]);
  if (snapshotRows.length === 0) {
    // No active run. A v2 cursor names a run that no longer exists (or
    // never did); anything else falls back to live ordering.
    if (cursor?.v === 2) throw new FeedCursorExpiredError();
    const { rows } = await query<FeedRowResult>(HELPFUL_SQL, [
      cafeId,
      viewerId,
      cursor?.v === 1 ? (cursor.likes ?? null) : null,
      cursor?.visited_at ?? null,
      cursor?.id ?? null,
      pageSize + 1,
    ]);
    return { rows, runId: null };
  }
  const runId = snapshotRows[0].run_id as string;
  // v1 cursors predate snapshots and are valid only while no active run
  // exists; a v2 cursor for any other run is a stale version.
  if (cursor && (cursor.v === 1 || cursor.run !== runId)) {
    throw new FeedCursorExpiredError();
  }
  // Drop the all-null sentinel row an empty page produces.
  return { rows: snapshotRows.filter((r) => r.id != null), runId };
}
