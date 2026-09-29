import "server-only";

import { isValidUUID } from "@shared/uuid";
import type { CheckInFeedMode } from "@/types/checkins";

/**
 * Feed cursor codec + errors (discovery leaf, BRAWUKA-749).
 *
 * Keyset-pagination cursors are server-issued, mode-bound opaque tokens —
 * never offsets. Newest orders by `visited_at DESC, id DESC`; Helpful by
 * `likes_count DESC, visited_at DESC, id DESC` (v1) or the frozen snapshot
 * `(score, visited_at, checkin_id)` tuple (v2, DG148). Likes may move a row
 * between requests, so pagination is best-effort and clients deduplicate by
 * check-in id.
 *
 * This leaf owns no SQL and imports no orchestration or persistence module;
 * the DB feed-read module and the domain-error mapper consume it directly.
 */

export class FeedCursorError extends Error {
  constructor(message = "invalid cursor") {
    super(message);
    this.name = "FeedCursorError";
  }
}

/**
 * A Helpful v2 cursor bound to a snapshot run that is no longer active
 * (DG148). The client restarts from page one; the route maps this to
 * `410 {code:"cursor_version_expired"}`.
 */
export class FeedCursorExpiredError extends Error {
  constructor(message = "cursor version expired") {
    super(message);
    this.name = "FeedCursorExpiredError";
  }
}

export interface FeedCursorV1 {
  v: 1;
  mode: CheckInFeedMode;
  likes?: number;
  visited_at: string;
  id: string;
}

/** Helpful snapshot cursor (DG148): bound to the run that issued it. */
export interface FeedCursorV2 {
  v: 2;
  mode: "helpful";
  run: string;
  score: number;
  visited_at: string;
  id: string;
}

export type FeedCursorPayload = FeedCursorV1 | FeedCursorV2;

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
  const p = parsed as {
    v?: unknown;
    mode?: unknown;
    likes?: unknown;
    run?: unknown;
    score?: unknown;
    visited_at?: unknown;
    id?: unknown;
  } | null;
  if (p === null || typeof p !== "object" || p.mode !== mode) {
    throw new FeedCursorError();
  }
  if (p.v === 2) {
    // Snapshot cursor: helpful only, bound to its issuing run (DG148).
    if (
      mode !== "helpful" ||
      typeof p.run !== "string" ||
      !isValidUUID(p.run) ||
      typeof p.score !== "number" ||
      !Number.isFinite(p.score) ||
      p.score < 0 ||
      typeof p.visited_at !== "string" ||
      Number.isNaN(Date.parse(p.visited_at)) ||
      typeof p.id !== "string" ||
      !isValidUUID(p.id)
    ) {
      throw new FeedCursorError();
    }
    return p as FeedCursorV2;
  }
  if (
    p.v !== 1 ||
    typeof p.visited_at !== "string" ||
    Number.isNaN(Date.parse(p.visited_at)) ||
    typeof p.id !== "string" ||
    !isValidUUID(p.id) ||
    (mode === "helpful" && (typeof p.likes !== "number" || !Number.isInteger(p.likes) || p.likes < 0))
  ) {
    throw new FeedCursorError();
  }
  return p as FeedCursorV1;
}
