/**
 * Agent-QA write ledger (BRAWUKA-408).
 *
 * Every entity a run creates (cafe/checkin/image ids) is appended here; the
 * run report and the cleanup both consume the ledger. Format is JSON lines —
 * appends are crash-safe (no whole-file rewrite) and a partial final line
 * from a killed run fails loud on read instead of silently dropping entries.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** Entity kinds the ledger accepts — exactly the kinds the run may create. */
export const LEDGER_KINDS = Object.freeze(["cafe", "checkin", "image"]);

/**
 * Validate and normalize one ledger entry. `createdAt` defaults to now when
 * absent; unknown kinds, empty ids, and unparseable timestamps throw — a
 * cleanup that silently skips a malformed entry would leak staging data.
 *
 * @param {unknown} entry candidate entry
 * @returns {{ runId: string, kind: string, id: string, createdAt: string }}
 */
export function validateLedgerEntry(entry) {
  if (typeof entry !== "object" || entry === null) {
    throw new Error("Agent-QA ledger entry must be an object.");
  }
  const { runId, kind, id, createdAt } = /** @type {Record<string, unknown>} */ (entry);
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error("Agent-QA ledger entry needs a non-empty runId.");
  }
  if (!LEDGER_KINDS.includes(/** @type {string} */ (kind))) {
    throw new Error(
      `Agent-QA ledger entry has unknown kind ${JSON.stringify(kind)} (known: ${LEDGER_KINDS.join(", ")}).`,
    );
  }
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Agent-QA ledger entry needs a non-empty id.");
  }
  const stamp = createdAt === undefined ? new Date().toISOString() : createdAt;
  if (typeof stamp !== "string" || Number.isNaN(Date.parse(stamp))) {
    throw new Error(`Agent-QA ledger entry has an unparseable createdAt: ${JSON.stringify(createdAt)}.`);
  }
  return { runId, kind: /** @type {string} */ (kind), id, createdAt: stamp };
}

/**
 * Append one entry to the per-run ledger file (created when missing).
 *
 * @param {string} ledgerPath ledger file path
 * @param {unknown} entry candidate entry
 * @returns {{ runId: string, kind: string, id: string, createdAt: string }} the stored entry
 */
export function appendLedgerEntry(ledgerPath, entry) {
  const stored = validateLedgerEntry(entry);
  appendFileSync(ledgerPath, `${JSON.stringify(stored)}\n`, "utf8");
  return stored;
}

/**
 * Read every entry of a ledger file in append order. A missing file reads as
 * empty (the run created nothing yet); a corrupt line throws naming the line —
 * cleanup must never run on a half-parsed ledger.
 *
 * @param {string} ledgerPath ledger file path
 * @returns {Array<{ runId: string, kind: string, id: string, createdAt: string }>}
 */
export function readLedger(ledgerPath) {
  if (!existsSync(ledgerPath)) return [];
  const entries = [];
  const lines = readFileSync(ledgerPath, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Agent-QA ledger is corrupt at line ${index + 1}: not valid JSON.`);
    }
    try {
      entries.push(validateLedgerEntry(parsed));
    } catch (error) {
      throw new Error(
        `Agent-QA ledger is corrupt at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  return entries;
}
