import "server-only";

import { isValidUUID } from "@shared/uuid";
import type { NavPromptItemDto } from "@shared/navigations/prompt";
import { appConfig } from "@/lib/config";
import {
  PromptQueue,
  type PromptAnswer,
  type PromptOutcome,
  type PromptQueueStore,
} from "@/lib/prompt-queue";
import {
  CafeNotFoundError,
  fail,
  type ParseResult,
} from "../validation/checkin";
import { query, type TxQueryFn } from "./postgres";

/** A row in the `navigations` table — one "导航" tap (spec 0001). */
interface RecordedNavigation {
  id: string;
  resolved: boolean;
  created_at: string;
}

/** The promptable projection of a navigation row, joined to its cafe. */
export type NavigationPromptItem = NavPromptItemDto;

/** Validate the POST /api/navigations body. */
export function parseNavigationBody(body: unknown): ParseResult<{ cafe_id: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("object body required");
  }
  const cafeId = (body as Record<string, unknown>).cafe_id;
  if (typeof cafeId !== "string" || !isValidUUID(cafeId)) {
    return fail("cafe_id (UUID string) required");
  }
  return { ok: true, value: { cafe_id: cafeId } };
}

const INSERT_NAVIGATION_SQL = `
insert into navigations (cafe_id, user_id)
select $1, $2
where exists (
  select 1 from cafes
  where id = $1 and deleted_at is null
    and (visibility = 'public' or created_by = $2)
)
returning id, resolved, created_at
`;

/**
 * Record a navigation intent ("导航" tap). Drives the ClassPass-style
 * "did you visit?" prompt on a later visit (spec 0001, DG78); the prompt
 * itself is served by `navigationPromptQueue` below. Throws
 * CafeNotFoundError when the cafe does not exist. Single statement
 * (BRAWUKA-279): the visibility gate lives inside the INSERT, so there is
 * one roundtrip and no TOCTOU — a cafe deleted between check and write
 * yields 0 rows (404), never an FK 500.
 */
export async function recordNavigation(
  userId: string,
  cafeId: string,
): Promise<RecordedNavigation> {
  if (!isValidUUID(userId)) throw new Error("Invalid user ID");
  if (!isValidUUID(cafeId)) throw new Error("Invalid cafe ID");

  const { rows } = await query<RecordedNavigation & Record<string, unknown>>(
    INSERT_NAVIGATION_SQL,
    [cafeId, userId],
  );
  const row = rows[0];
  if (!row) throw new CafeNotFoundError(cafeId);
  return row;
}

/* ------------------------------------------------------------------ *
 * Prompt-queue store (DG91): the navigations table is the queue's
 * persistence; `web/lib/prompt-queue` owns the generic semantics.
 * ------------------------------------------------------------------ */

/**
 * Eligibility (spec 0001, DG78/DG83/DG91): unresolved, at least
 * `minAgeHours` old (earliest the next day), younger than `expiryDays`,
 * not past the re-ask cap, and either never deferred or last deferred ≥
 * `reaskDelayHours` ago. The cafe join drops prompts whose cafe was
 * deleted or is private to someone else — a prompt the user never asked
 * for gets no error UI (design §5).
 */
const NEXT_PROMPT_SQL = `
select n.id, n.created_at, c.id as cafe_id, c.name as cafe_name, c.cover as cafe_cover
from navigations n
join cafes c on c.id = n.cafe_id
where n.user_id = $1
  and n.resolved = false
  and n.ask_count <= $5
  and n.created_at <= now() - $2::float8 * interval '1 hour'
  and n.created_at > now() - $3::float8 * interval '1 day'
  and (n.last_asked_at is null or n.last_asked_at <= now() - $4::float8 * interval '1 hour')
  and c.deleted_at is null
  and (c.visibility = 'public' or c.created_by = $1)
order by n.created_at desc
limit 1
`;

/**
 * Terminal answers resolve permanently — the shown row AND every other
 * unresolved navigation the user has to the same cafe (BRAWUKA-270): each
 * "导航" tap stacks a row, and answering for the cafe once must retire the
 * whole stack or a declined cafe re-prompts in a later session. Siblings
 * take the same outcome, matching the funnel's per-row counting (DG80).
 * The `resolved = false` guards keep the write idempotent: a second answer
 * never overwrites a stored outcome — including the `auto` outcome a
 * completed check-in wrote — and the same guard inside the subquery makes
 * a stale retry on an already-resolved id a no-op (subquery NULL → no rows
 * matched → stored-outcome path), so it can never consume a fresh
 * navigation the user was never prompted about.
 */
const RESOLVE_PROMPT_SQL = `
update navigations
set resolved = true, outcome = $3
where resolved = false
  and user_id = $2
  and cafe_id = (select cafe_id from navigations where id = $1 and user_id = $2 and resolved = false)
`;

/**
 * "还没去" (not_yet): stamp the re-ask delay and send the item to the back
 * of the queue — again sibling-scoped, so stacked taps to one cafe share a
 * single re-ask budget instead of each starting its own cycle. Past
 * `maxReasks` the stack auto-resolves instead (DG91). The subquery's
 * `resolved = false` guard is the same stale-retry no-op as above.
 */
const DEFER_PROMPT_SQL = `
update navigations
set ask_count = ask_count + 1,
    last_asked_at = now(),
    resolved = (ask_count + 1 > $3),
    outcome = case when ask_count + 1 > $3 then 'auto' else outcome end
where resolved = false
  and user_id = $2
  and cafe_id = (select cafe_id from navigations where id = $1 and user_id = $2 and resolved = false)
`;

/** Read the stored outcome for idempotent re-answers; null when the row is gone. */
const PROMPT_OUTCOME_SQL = `
select outcome from navigations where id = $1 and user_id = $2
`;

const navigationPromptStore: PromptQueueStore<NavigationPromptItem> = {
  async nextEligible(userId, params) {
    const { rows } = await query<
      {
        id: string;
        created_at: string;
        cafe_id: string;
        cafe_name: string;
        cafe_cover: string | null;
      } & Record<string, unknown>
    >(NEXT_PROMPT_SQL, [
      userId,
      params.minAgeHours,
      params.expiryDays,
      params.reaskDelayHours,
      params.maxReasks,
    ]);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      created_at: row.created_at,
      cafe: { id: row.cafe_id, name: row.cafe_name, cover: row.cafe_cover },
    };
  },

  async answer(userId, itemId, answer, params) {
    const sql = answer === "not_yet" ? DEFER_PROMPT_SQL : RESOLVE_PROMPT_SQL;
    const res =
      answer === "not_yet"
        ? await query(sql, [itemId, userId, params.maxReasks])
        : await query(sql, [itemId, userId, answer]);
    if ((res.rowCount ?? 0) > 0) {
      return { status: "answered", outcome: answer };
    }
    // Idempotent re-answer: the row resolved between fetch and answer (or a
    // double-tap) — report the stored outcome instead of a 404.
    const { rows } = await query<{ outcome: string | null } & Record<string, unknown>>(
      PROMPT_OUTCOME_SQL,
      [itemId, userId],
    );
    const row = rows[0];
    if (!row) return { status: "gone" };
    return {
      status: "answered",
      // Stored outcome wins over the repeated answer (DG80 funnel truth);
      // the CHECK constraint keeps it inside PromptOutcome.
      outcome: (row.outcome ?? answer) as PromptOutcome,
    };
  },
};

/**
 * The navigation return-prompt queue (DG91): one prompt per session,
 * earliest the next day, 3-month expiry, ≥1-day back-of-queue re-ask,
 * max 2 re-asks — all from `app.yaml` `promptQueue`.
 */
export const navigationPromptQueue = new PromptQueue<NavigationPromptItem>(
  navigationPromptStore,
  appConfig.promptQueue,
);

/** Validate the POST /api/navigations/[id]/resolve body. */
export function parsePromptAnswerBody(body: unknown): ParseResult<{ outcome: PromptAnswer }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("object body required");
  }
  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome !== "visited" && outcome !== "wont_go" && outcome !== "not_yet") {
    return fail("outcome must be one of: visited, wont_go, not_yet");
  }
  return { ok: true, value: { outcome } };
}

/**
 * DG79: any check-in at a cafe silently resolves that user's pending
 * navigations to it with outcome `auto`. Runs inside the caller's
 * transaction so the resolution commits or rolls back with the check-in.
 * `resolved = false` preserves a `visited` outcome already recorded by the
 * prompt's 有去！ answer.
 */
export async function autoResolveNavigationsTx(
  q: TxQueryFn,
  userId: string,
  cafeId: string,
): Promise<void> {
  await q(
    `update navigations set resolved = true, outcome = 'auto'
     where user_id = $1 and cafe_id = $2 and resolved = false`,
    [userId, cafeId],
  );
}
