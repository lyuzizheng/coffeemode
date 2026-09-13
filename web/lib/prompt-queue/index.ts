import "server-only";

/**
 * Generic per-user prompt queue (DG91, spec 0001 §Check-in system).
 *
 * Built as a reusable service component — not navigation logic coupled into
 * the prompt card. A feature that wants a "tap on the shoulder" prompt
 * supplies a {@link PromptQueueStore}; this class owns the queue semantics:
 *
 * - `next()` returns at most one eligible item per call — the caller shows
 *   one prompt per session and decides when to ask again.
 * - `answer(item, "not_yet")` sends the item to the BACK of the queue: the
 *   store stamps `last_asked_at` and the item becomes eligible again only
 *   after `reaskDelayHours`. An item dequeued at an ineligible moment is
 *   re-queued, never dropped.
 * - After `maxReasks` "not yet" answers the item auto-resolves instead of
 *   being asked forever.
 * - Terminal answers ("visited" / "wont_go") resolve the item permanently.
 *
 * Product parameters (min age, expiry, re-ask delay, re-ask cap) arrive via
 * {@link PromptQueueParams} from `web/config/app.yaml` — never hardcoded.
 */

/** Stored outcome values (DG80). "auto" is written by check-in auto-resolve. */
export type PromptOutcome = "visited" | "wont_go" | "not_yet" | "auto";

/** Answers the prompt UI can send; "auto" is never user-answerable. */
export type PromptAnswer = Exclude<PromptOutcome, "auto">;

export const PROMPT_ANSWERS: readonly PromptAnswer[] = ["visited", "wont_go", "not_yet"];

export interface PromptQueueParams {
  /** A navigation never prompts before this age (DG78: earliest next day). */
  minAgeHours: number;
  /** Items older than this never prompt (DG83: 3 months). */
  expiryDays: number;
  /** "not_yet" re-ask delay — the item goes to the back of the queue (DG91). */
  reaskDelayHours: number;
  /** Re-ask cap: the (maxReasks + 1)-th "not yet" auto-resolves (DG91). */
  maxReasks: number;
}

export interface PromptQueueItem {
  id: string;
  created_at: string;
}

export type PromptAnswerResult =
  | { status: "answered"; outcome: PromptOutcome }
  | { status: "gone" };

/**
 * Persistence seam a feature implements to join the queue. All reads/writes
 * are scoped to one user; the store owns its own table and eligibility SQL.
 */
export interface PromptQueueStore<T extends PromptQueueItem> {
  /**
   * The most recent eligible item for the user, or null. Eligibility:
   * unresolved, younger than `expiryDays`, at least `minAgeHours` old, and
   * either never deferred or last deferred ≥ `reaskDelayHours` ago.
   */
  nextEligible(userId: string, params: PromptQueueParams): Promise<T | null>;
  /**
   * Record a user answer. "not_yet" stamps the re-ask delay and increments
   * the ask counter, auto-resolving past `maxReasks`; terminal answers
   * resolve permanently. Must be idempotent for already-resolved items.
   */
  answer(userId: string, itemId: string, answer: PromptAnswer, params: PromptQueueParams): Promise<PromptAnswerResult>;
}

export class PromptQueue<T extends PromptQueueItem> {
  constructor(
    private readonly store: PromptQueueStore<T>,
    private readonly params: PromptQueueParams,
  ) {}

  /** Next prompt to show this session, or null when the queue is empty. */
  next(userId: string): Promise<T | null> {
    return this.store.nextEligible(userId, this.params);
  }

  /** Record the user's answer to a shown prompt. */
  answer(userId: string, itemId: string, answer: PromptAnswer): Promise<PromptAnswerResult> {
    return this.store.answer(userId, itemId, answer, this.params);
  }
}
