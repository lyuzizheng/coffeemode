import "server-only";

/**
 * Account-scope advisory lock (BRAWUKA-676): serializes check-in creation
 * against deleteAccount for one user.
 *
 * deleteAccount reads its cafe + live check-in lock set in one snapshot,
 * then tombstones every check-in the user still owns with a blanket UPDATE.
 * Between those two statements a check-in could commit on a cafe outside
 * the lock set: the row was tombstoned and detached correctly, but its
 * cafe's gallery entries and work_stats contribution survived — taking
 * that cafe's lock after the check-in locks would invert the cafe →
 * checkin order and reopen the 40P01 cycle BRAWUKA-601 closed.
 *
 * Closing the window needs the writer's cooperation: every transaction
 * that can INSERT a check-in (createCheckIn, createCafeWithFirstCheckIn)
 * takes this lock as its FIRST statement, and deleteAccount takes it first
 * too. A create that reaches the window then waits for the delete to
 * commit and fails the checkins.user_id FK — the residual state can never
 * be produced. First-statement placement means a waiter holds no other
 * lock, so this lock can never join a deadlock cycle (same argument as
 * ACQUIRE_CREATE_LOCK_SQL, BRAWUKA-125).
 *
 * Transaction-scoped (`pg_advisory_xact_lock` releases on commit/rollback,
 * safe under pooling — never `pg_advisory_lock`). `hashtextextended` keys
 * the 64-bit lock space; the 'account-write:' prefix documents the domain.
 * A hash collision only over-serializes unrelated users, never misses.
 */
export const ACQUIRE_ACCOUNT_WRITE_LOCK_SQL =
  "select pg_advisory_xact_lock(hashtextextended('account-write:' || $1, 0))";
