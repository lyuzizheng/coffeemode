import "server-only";

import { query } from "./postgres";

/**
 * `beta_allowlist` reads and operator writes (BRAWUKA-970, spec 0001 §Closed
 * beta). One row per invited address; `revoked_at` retires it without losing
 * the audit trail. Every read path in the app goes through here, so
 * normalization (trim + lowercase) cannot drift between the sign-in gate, the
 * API gate, and the operator CLI.
 */

export interface BetaAllowlistEntry {
  email: string;
  note: string | null;
  created_at: Date;
  revoked_at: Date | null;
}

/** Canonical form of an invited address — the table stores only this form. */
export function normalizeBetaEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True when the live allowlist admits this address (revoked rows never do). */
export async function isBetaEmailAllowed(email: string): Promise<boolean> {
  const { rows } = await query<{ live: number }>(
    "select 1 as live from beta_allowlist where email = $1 and revoked_at is null",
    [normalizeBetaEmail(email)],
  );
  return rows.length > 0;
}

/** Every invited address, live first, then newest — the operator's view. */
export async function listBetaAllowlist(): Promise<BetaAllowlistEntry[]> {
  const { rows } = await query<BetaAllowlistEntry & Record<string, unknown>>(
    `select email, note, created_at, revoked_at
       from beta_allowlist
      order by revoked_at nulls first, created_at desc`,
  );
  return rows;
}

/**
 * Invite an address. Re-inviting a revoked address clears `revoked_at` and
 * keeps the original `created_at` — the row records that the address was
 * invited, then withdrawn, then invited again.
 */
export async function inviteBetaEmail(email: string, note: string | null): Promise<void> {
  await query(
    `insert into beta_allowlist (email, note)
     values ($1, $2)
     on conflict (email) do update
        set note = excluded.note,
            revoked_at = null`,
    [normalizeBetaEmail(email), note],
  );
}

/** Retire an address. Returns false when it was never invited. */
export async function revokeBetaEmail(email: string): Promise<boolean> {
  const { rows } = await query<{ email: string }>(
    `update beta_allowlist
        set revoked_at = now()
      where email = $1 and revoked_at is null
      returning email`,
    [normalizeBetaEmail(email)],
  );
  return rows.length > 0;
}
