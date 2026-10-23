/**
 * Shared Supabase env contract (BRAWUKA-408, BRAWUKA-950).
 *
 * Single source of truth for the server-side staging Supabase env triple
 * (`SUPABASE_URL`, publishable key, secret key). Consumed by
 * `scripts/agent-qa/session.mjs` (magic-link agent-QA sessions).
 *
 * API-key names follow Supabase's new contract first — `SUPABASE_PUBLISHABLE_KEY`
 * (public mirror `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` accepted) and
 * `SUPABASE_SECRET_KEY` — and fall back to the legacy `*_ANON_KEY` /
 * `SUPABASE_SERVICE_ROLE_KEY` names so a half-migrated environment keeps
 * working while the old keys are retired (BRAWUKA-950).
 *
 * The secret key is read ONLY from server-side names — a `NEXT_PUBLIC_*`
 * mirror is never honored, so the key cannot leak into a client bundle
 * through this module. There are no defaults and no target guessing: missing
 * variables throw listing every gap.
 */

/**
 * Read the triple and name every gap, without throwing. The gap descriptions
 * are the contract `scripts/agent-qa/preconditions.mjs` reports, so a caller
 * never has to parse the resolver's error message (and never sees a value).
 *
 * @param {Record<string, string | undefined>} env env source
 */
function readSupabaseEnv(env) {
  const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    env.SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.SUPABASE_ANON_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  /** @type {string[]} */
  const missing = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
  if (!publishableKey) {
    missing.push(
      "SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; legacy SUPABASE_ANON_KEY accepted)",
    );
  }
  if (!secretKey) {
    missing.push(
      "SUPABASE_SECRET_KEY (server-side only, never NEXT_PUBLIC_*; legacy SUPABASE_SERVICE_ROLE_KEY accepted)",
    );
  }
  return { supabaseUrl, publishableKey, secretKey, missing };
}

/**
 * The Supabase env gaps as a list — empty when the triple resolves. Names
 * only: a value never leaves this module through the gap list.
 *
 * @param {Record<string, string | undefined>} [env] env source (default: process.env)
 * @returns {string[]}
 */
export function supabaseEnvMissing(env = process.env) {
  return readSupabaseEnv(env).missing;
}

/**
 * Resolve the Supabase env triple. Throws listing every missing variable.
 *
 * @param {Record<string, string | undefined>} [env] env source (default: process.env)
 * @param {string} [contextLabel] prefix for the not-configured error
 * @returns {{ supabaseUrl: string, publishableKey: string, secretKey: string }}
 */
export function resolveSupabaseEnvCore(env = process.env, contextLabel = "Supabase") {
  const { supabaseUrl, publishableKey, secretKey, missing } = readSupabaseEnv(env);
  if (missing.length > 0) {
    throw new Error(`${contextLabel} is not configured. Missing: ${missing.join(", ")}.`);
  }
  return {
    supabaseUrl: /** @type {string} */ (supabaseUrl).replace(/\/+$/, ""),
    publishableKey: /** @type {string} */ (publishableKey),
    secretKey: /** @type {string} */ (secretKey),
  };
}
