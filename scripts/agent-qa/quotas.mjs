/**
 * Agent-QA per-run write quotas (BRAWUKA-408).
 *
 * A runaway agent must not flood shared staging: every entity-creating step
 * records its write here first, and the first write past the cap throws,
 * aborting the run. Quotas are intentionally small — the journeys under test
 * need a handful of entities, never dozens.
 */

/** Maximum entities of each kind one agent-QA run may create. */
export const AGENT_QA_WRITE_QUOTAS = Object.freeze({ cafe: 3, checkin: 5, image: 2 });

/** @returns {{ cafe: number, checkin: number, image: number }} a zeroed tracker */
export function createQuotaTracker() {
  return { cafe: 0, checkin: 0, image: 0 };
}

/**
 * Record one write of `kind`. Returns the new count; throws when the write
 * would exceed the per-run cap, or when `kind` is not a quota-tracked entity.
 *
 * @param {{ cafe: number, checkin: number, image: number }} tracker
 * @param {string} kind entity kind (`cafe` | `checkin` | `image`)
 * @returns {number} writes of this kind so far, including this one
 */
export function recordWrite(tracker, kind) {
  if (!Object.prototype.hasOwnProperty.call(AGENT_QA_WRITE_QUOTAS, kind)) {
    throw new Error(
      `Agent-QA write quota: unknown entity kind ${JSON.stringify(kind)} (tracked: ${Object.keys(AGENT_QA_WRITE_QUOTAS).join(", ")}).`,
    );
  }
  if (tracker[kind] >= AGENT_QA_WRITE_QUOTAS[kind]) {
    throw new Error(
      `Agent-QA write quota exceeded: at most ${AGENT_QA_WRITE_QUOTAS[kind]} ${kind}(s) per run.`,
    );
  }
  tracker[kind] += 1;
  return tracker[kind];
}
