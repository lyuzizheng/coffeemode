/**
 * Agent-QA session bootstrap (BRAWUKA-408).
 *
 * Staging sessions for the agent browser are bootstrapped through the
 * Supabase Auth Admin API with the staging `service_role` key, then handed
 * to the browser as a magic-link URL for navigation through the real
 * `/auth/callback` route — the same code path a human invite email uses.
 * `sb-*` cookies are NEVER injected: that would couple the scaffold to
 * `@supabase/ssr` cookie internals.
 *
 * `service_role` boundary: read ONLY from the server-side
 * `SUPABASE_SERVICE_ROLE_KEY` env var (via the shared
 * `supabase-env.mjs` core, same contract as
 * `web/tests/helpers/staging-session.ts`). It travels in Admin-API request
 * headers only and must never reach a prompt, browser page, or client
 * bundle — the returned session carries the user id, the email, and the
 * magic-link URL, never the key.
 */

import { assertAllowedUrl } from "./allowlist.mjs";
import { AGENT_QA_REGULAR_EMAIL, buildFreshEmail, isProtectedPersona } from "./personas.mjs";
import { resolveSupabaseEnvCore } from "./supabase-env.mjs";

/** Default `redirect_to` for magic links: the real staging callback route. */
export const AGENT_QA_MAGIC_LINK_REDIRECT = "https://staging.cafemood.app/auth/callback";

/**
 * Resolve the agent-QA Supabase env contract (shared core, agent-QA label).
 *
 * @param {Record<string, string | undefined>} [env] env source (default: process.env)
 */
export function resolveAgentQaSupabaseEnv(env = process.env) {
  return resolveSupabaseEnvCore(env, "Agent-QA Supabase");
}

/**
 * @param {string} op operation name for error messages
 * @param {number} status HTTP status
 * @param {string} body response body (truncated)
 */
function sessionError(op, status, body) {
  return new Error(`Agent-QA session ${op} failed (HTTP ${status}): ${body.slice(0, 500)}`);
}

/**
 * @param {Response} res fetch response
 * @param {string} op operation name
 * @returns {Promise<never>}
 */
async function readFailure(res, op) {
  const body = await res.text().catch(() => "");
  throw sessionError(op, res.status, body);
}

/**
 * @param {string} supabaseUrl base URL (no trailing slash)
 * @param {string} serviceRoleKey server-side key (headers only)
 */
function adminHeaders(supabaseUrl, serviceRoleKey) {
  void supabaseUrl;
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
}

/**
 * Create a test user through the Auth Admin API (`email_confirm: true`, no
 * password — the magic-link flow needs none and unsent secrets stay unmade).
 *
 * @param {{ supabaseUrl: string, anonKey: string, serviceRoleKey: string }} resolved resolved env
 * @param {string} email test-user email (a persona address)
 * @param {{ fetchImpl?: typeof fetch, password?: string }} [opts]
 * @returns {Promise<string>} the new user id
 */
export async function createAgentQaUser(resolved, email, { fetchImpl = globalThis.fetch, password } = {}) {
  const res = await fetchImpl(`${resolved.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(resolved.supabaseUrl, resolved.serviceRoleKey),
    body: JSON.stringify({
      email,
      email_confirm: true,
      ...(password === undefined ? {} : { password }),
    }),
  });
  if (!res.ok) await readFailure(res, "create user");
  const data = await res.json();
  const userId = data?.user?.id ?? data?.id;
  if (!userId) throw new Error("Agent-QA session create user returned no user id.");
  return userId;
}

/**
 * Delete a test user through the Auth Admin API. A 404 (already deleted)
 * resolves so cleanup stays green on double runs. Refuses the persistent
 * regular persona — that identity is never deleted by this scaffold.
 *
 * @param {{ supabaseUrl: string, anonKey: string, serviceRoleKey: string }} resolved resolved env
 * @param {string} userId user id to delete
 * @param {{ fetchImpl?: typeof fetch, email?: string }} [opts] `email` enables the persona guard
 */
export async function deleteAgentQaUser(resolved, userId, { fetchImpl = globalThis.fetch, email } = {}) {
  if (email !== undefined && isProtectedPersona(email)) {
    throw new Error(
      `Agent-QA session refuses to delete the persistent persona (${AGENT_QA_REGULAR_EMAIL}); delete only fresh-persona users.`,
    );
  }
  const res = await fetchImpl(
    `${resolved.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: resolved.serviceRoleKey,
        authorization: `Bearer ${resolved.serviceRoleKey}`,
      },
    },
  );
  if (res.status === 404) return;
  if (!res.ok) await readFailure(res, "delete user");
}

/**
 * Mint a magic link through `auth.admin.generateLink` and return the URL for
 * browser navigation through the real `/auth/callback`. The URL carries a
 * one-time token, never the `service_role` key.
 *
 * @param {{ supabaseUrl: string, anonKey: string, serviceRoleKey: string }} resolved resolved env
 * @param {string} email test-user email
 * @param {{ fetchImpl?: typeof fetch, redirectTo?: string }} [opts]
 * @returns {Promise<string>} the magic-link URL
 */
export async function generateAgentQaMagicLink(
  resolved,
  email,
  { fetchImpl = globalThis.fetch, redirectTo = AGENT_QA_MAGIC_LINK_REDIRECT } = {},
) {
  assertAllowedUrl(redirectTo);
  const res = await fetchImpl(`${resolved.supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: adminHeaders(resolved.supabaseUrl, resolved.serviceRoleKey),
    body: JSON.stringify({ type: "magiclink", email, options: { redirect_to: redirectTo } }),
  });
  if (!res.ok) await readFailure(res, "generate magic link");
  const data = await res.json();
  const actionLink = data?.properties?.action_link ?? data?.action_link;
  if (typeof actionLink !== "string" || actionLink === "") {
    throw new Error("Agent-QA session generate magic link returned no action link.");
  }
  return actionLink;
}

/**
 * Bootstrap a per-run fresh-persona session: create the user, mint its magic
 * link. A link failure best-effort deletes the orphan user (mirroring
 * `createStagingTestSession`) without masking the original error.
 *
 * @param {{ supabaseUrl: string, anonKey: string, serviceRoleKey: string }} resolved resolved env
 * @param {string} runId run identifier (owns the fresh persona email)
 * @param {{ fetchImpl?: typeof fetch, redirectTo?: string }} [opts]
 * @returns {Promise<{ userId: string, email: string, magicLinkUrl: string, dispose: () => Promise<void> }>}
 */
export async function bootstrapAgentQaFreshSession(resolved, runId, opts = {}) {
  const { fetchImpl = globalThis.fetch } = opts;
  const email = buildFreshEmail(runId);
  const userId = await createAgentQaUser(resolved, email, { fetchImpl });
  let magicLinkUrl;
  try {
    magicLinkUrl = await generateAgentQaMagicLink(resolved, email, opts);
  } catch (linkError) {
    await deleteAgentQaUser(resolved, userId, { fetchImpl, email }).catch(() => {});
    throw linkError;
  }
  return {
    userId,
    email,
    magicLinkUrl,
    dispose: () => deleteAgentQaUser(resolved, userId, { fetchImpl, email }),
  };
}
