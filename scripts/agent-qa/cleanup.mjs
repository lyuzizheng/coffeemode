/**
 * Agent-QA cleanup (BRAWUKA-408).
 *
 * Two modes, both best-effort per item (one stubborn entity must not hide the
 * rest) and both consulting the persona guard:
 *
 *   - Ledger cleanup: delete what this run created. Cafes and checkins go
 *     through the app's own DELETE routes (same code paths a real user
 *     exercises); images have no app delete endpoint, so they plan as `skip`
 *     with a reason instead of pretending to delete. Auth users are swept
 *     via `planUserSweep` (age-gated fresh-persona only, regular persona and
 *     foreign addresses never qualify) and deleted by the caller through
 *     `session.mjs`'s `deleteAgentQaUser` Admin-API call — this module never
 *     touches the `service_role` key.
 *   - Sweep: delete `agent-qa-fresh-*` users (and, via their ledgers,
 *     orphaned entities) older than N days. The persistent
 *     `agent-qa-regular` persona and every foreign address never qualify —
 *     `isAgentQaSweepCandidate` pins that exclusion.
 */

import { assertAllowedUrl } from "./allowlist.mjs";
import { parseAgentQaEmail } from "./personas.mjs";

export const AGENT_QA_SWEEP_DEFAULT_MAX_AGE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** App DELETE route per ledgered entity kind. Images: none — see buildCleanupPlan. */
const ENTITY_DELETE_PATHS = Object.freeze({
  cafe: (id) => `/api/cafes/${encodeURIComponent(id)}`,
  checkin: (id) => `/api/checkins/${encodeURIComponent(id)}`,
});

/**
 * Sweep predicate for auth users. True ONLY for fresh-persona addresses older
 * than `maxAgeDays`. The regular persona, foreign addresses, malformed emails,
 * and non-finite timestamps all return false.
 *
 * @param {unknown} email user email
 * @param {number} createdAtMs user creation time (epoch ms)
 * @param {number} [nowMs] now (epoch ms; default: Date.now())
 * @param {number} [maxAgeDays] age threshold in days
 * @returns {boolean}
 */
export function isAgentQaSweepCandidate(email, createdAtMs, nowMs = Date.now(), maxAgeDays = 7) {
  if (parseAgentQaEmail(email)?.persona !== "fresh") return false;
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(maxAgeDays)) return false;
  return nowMs - createdAtMs > maxAgeDays * DAY_MS;
}

/**
 * @typedef {{ email: string, createdAtMs: number }} SweepUser
 * @typedef {{ runId: string, kind: string, id: string, createdAt: string }} LedgerEntry
 * @typedef {LedgerEntry & ({ action: "delete", method: string, path: string } | { action: "skip", reason: string })} CleanupPlanItem
 */

/**
 * Split candidate users into sweep removals and keeps. `keep` carries every
 * non-candidate (regular persona, recent fresh users, foreign addresses) so
 * the report can show what was deliberately left alone.
 *
 * @param {SweepUser[]} users
 * @param {{ nowMs?: number, maxAgeDays?: number }} [opts]
 * @returns {{ remove: SweepUser[], keep: SweepUser[] }}
 */
export function planUserSweep(users, { nowMs = Date.now(), maxAgeDays = 7 } = {}) {
  const remove = [];
  const keep = [];
  for (const user of users) {
    if (isAgentQaSweepCandidate(user.email, user.createdAtMs, nowMs, maxAgeDays)) remove.push(user);
    else keep.push(user);
  }
  return { remove, keep };
}

/**
 * Turn ledger entries into an executable plan. Cafes/checkins plan as app-API
 * deletes; images plan as `skip` — there is no app delete endpoint for them,
 * and inventing a direct-storage delete here would bypass the app's own
 * authorization paths.
 *
 * No age filter here by design: the caller owns entity-age selection.
 * Ledger cleanup passes the run's own ledger wholesale (delete what this run
 * created, however young); sweep passes only ledgers of users `planUserSweep`
 * already aged out. Pre-filtering the run's own ledger by age here would leak
 * same-run writes.
 *
 * @param {LedgerEntry[]} ledgerEntries
 * @returns {CleanupPlanItem[]}
 */
export function buildCleanupPlan(ledgerEntries) {
  return ledgerEntries.map((entry) => {
    const toPath = ENTITY_DELETE_PATHS[/** @type {keyof typeof ENTITY_DELETE_PATHS} */ (entry.kind)];
    if (!toPath) {
      return {
        ...entry,
        action: "skip",
        reason: `no app delete endpoint for kind "${entry.kind}" — remove via storage lifecycle, not this scaffold`,
      };
    }
    return { ...entry, action: "delete", method: "DELETE", path: toPath(entry.id) };
  });
}

/**
 * Execute a cleanup plan against the staging app. Every target URL passes the
 * allowlist guard first, so a corrupted ledger cannot turn cleanup into a
 * weapon against other hosts. Item failures are recorded, never thrown — the
 * caller gets the full per-item account in plan order.
 *
 * @param {ReturnType<typeof buildCleanupPlan>} plan
 * @param {{ appBaseUrl: string, headers?: Record<string, string>, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<Array<{ kind: string, id: string, ok: boolean, skipped?: boolean, status?: number, error?: string }>>}
 */
export async function executeCleanupPlan(plan, { appBaseUrl, headers = {}, fetchImpl = globalThis.fetch }) {
  const results = [];
  for (const item of plan) {
    if (item.action === "skip") {
      results.push({ kind: item.kind, id: item.id, ok: true, skipped: true, error: item.reason });
      continue;
    }
    const url = new URL(item.path ?? "/", appBaseUrl).toString();
    assertAllowedUrl(url);
    try {
      const res = await fetchImpl(url, { method: item.method ?? "DELETE", headers });
      results.push({
        kind: item.kind,
        id: item.id,
        ok: res.ok,
        status: res.status,
        ...(res.ok ? {} : { error: `Agent-QA cleanup delete failed (HTTP ${res.status}).` }),
      });
    } catch (error) {
      results.push({
        kind: item.kind,
        id: item.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
