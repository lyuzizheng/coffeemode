/**
 * Agent-QA test personas (BRAWUKA-408).
 *
 * Two identities, deliberately distinct from the scripted staging-journey
 * users (`staging-journey+…` in `web/tests/helpers/staging-session.ts`):
 *
 *   - `agent-qa-fresh-<runId>@coffeemode.test` — per-run, deleted after the run.
 *   - `agent-qa-regular@coffeemode.test` — persistent, seeded history, NEVER
 *     deleted by cleanup (this corrects the design's email-pattern sweep,
 *     which would have matched and deleted it).
 *
 * The `coffeemode.test` domain is non-routable, matching the existing
 * staging-session convention — these addresses can never reach a real inbox.
 */

export const AGENT_QA_TEST_DOMAIN = "coffeemode.test";

export const AGENT_QA_FRESH_PREFIX = "agent-qa-fresh-";

export const AGENT_QA_REGULAR_LOCAL_PART = "agent-qa-regular";

export const AGENT_QA_REGULAR_EMAIL = `${AGENT_QA_REGULAR_LOCAL_PART}@${AGENT_QA_TEST_DOMAIN}`;

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Build the per-run fresh persona email. The run id is caller-supplied (the
 * runner owns id generation); it is validated so a malformed id cannot widen
 * the sweep pattern into something that matches foreign users.
 *
 * @param {string} runId run identifier, e.g. a hyphen-stripped UUID
 * @returns {string} the fresh persona email for this run
 */
export function buildFreshEmail(runId) {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      `Agent-QA fresh email needs a run id of 1-64 [A-Za-z0-9_-] characters, got: ${JSON.stringify(runId)}.`,
    );
  }
  return `${AGENT_QA_FRESH_PREFIX}${runId}@${AGENT_QA_TEST_DOMAIN}`;
}

/**
 * Classify an email as an agent-QA identity. Returns null for anything that
 * is not one — foreign and journey addresses never classify, so sweep and
 * cleanup predicates built on this can never touch them.
 *
 * @param {unknown} email address to classify
 * @returns {{ persona: "fresh" | "regular", runId: string | null } | null}
 */
export function parseAgentQaEmail(email) {
  if (typeof email !== "string") return null;
  const at = email.indexOf("@");
  if (at < 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain !== AGENT_QA_TEST_DOMAIN) return null;
  if (local === AGENT_QA_REGULAR_LOCAL_PART) return { persona: "regular", runId: null };
  if (local.startsWith(AGENT_QA_FRESH_PREFIX)) {
    const runId = local.slice(AGENT_QA_FRESH_PREFIX.length);
    if (!RUN_ID_PATTERN.test(runId)) return null;
    return { persona: "fresh", runId };
  }
  return null;
}

/**
 * @param {unknown} email
 * @returns {boolean} true only for agent-QA identities (fresh or regular)
 */
export function isAgentQaEmail(email) {
  return parseAgentQaEmail(email) !== null;
}

/**
 * The persistent persona is excluded from every deletion path: lifecycle
 * delete, ledger cleanup, and age sweep all consult this.
 *
 * @param {unknown} email
 * @returns {boolean} true only for the persistent regular persona
 */
export function isProtectedPersona(email) {
  return parseAgentQaEmail(email)?.persona === "regular";
}
