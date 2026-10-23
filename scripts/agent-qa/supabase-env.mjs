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
 * Resolve the Supabase env triple. Throws listing every missing variable.
 *
 * @param {Record<string, string | undefined>} [env] env source (default: process.env)
 * @param {string} [contextLabel] prefix for the not-configured error
 * @returns {{ supabaseUrl: string, publishableKey: string, secretKey: string }}
 */
export function resolveSupabaseEnvCore(env = process.env, contextLabel = "Supabase") {
  const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    env.SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.SUPABASE_ANON_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !supabaseUrl ? "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)" : null,
    !publishableKey
      ? "SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; legacy SUPABASE_ANON_KEY accepted)"
      : null,
    !secretKey
      ? "SUPABASE_SECRET_KEY (server-side only, never NEXT_PUBLIC_*; legacy SUPABASE_SERVICE_ROLE_KEY accepted)"
      : null,
  ].filter((entry) => entry !== null);
  if (missing.length > 0) {
    throw new Error(`${contextLabel} is not configured. Missing: ${missing.join(", ")}.`);
  }
  return {
    supabaseUrl: /** @type {string} */ (supabaseUrl).replace(/\/+$/, ""),
    publishableKey: /** @type {string} */ (publishableKey),
    secretKey: /** @type {string} */ (secretKey),
  };
}
