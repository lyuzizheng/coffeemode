/**
 * Shared Supabase env contract (BRAWUKA-408).
 *
 * Single source of truth for the server-side staging Supabase env triple
 * (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, with the
 * public `NEXT_PUBLIC_*` mirrors accepted for the non-secret URL/publishable pair
 * only). Consumed by `scripts/agent-qa/session.mjs` (magic-link agent-QA
 * sessions).
 *
 * The `service_role` key is read ONLY from `SUPABASE_SERVICE_ROLE_KEY` — a
 * `NEXT_PUBLIC_*` mirror is never honored, so the key cannot leak into a
 * client bundle through this module. There are no defaults and no target
 * guessing: missing variables throw listing every gap.
 */

/**
 * Resolve the Supabase env triple. Throws listing every missing variable.
 *
 * @param {Record<string, string | undefined>} [env] env source (default: process.env)
 * @param {string} [contextLabel] prefix for the not-configured error
 * @returns {{ supabaseUrl: string, anonKey: string, serviceRoleKey: string }}
 */
export function resolveSupabaseEnvCore(env = process.env, contextLabel = "Supabase") {
  const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !supabaseUrl ? "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)" : null,
    !anonKey ? "SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)" : null,
    !serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY (server-side only, never NEXT_PUBLIC_*)" : null,
  ].filter((entry) => entry !== null);
  if (missing.length > 0) {
    throw new Error(`${contextLabel} is not configured. Missing: ${missing.join(", ")}.`);
  }
  return {
    supabaseUrl: /** @type {string} */ (supabaseUrl).replace(/\/+$/, ""),
    anonKey: /** @type {string} */ (anonKey),
    serviceRoleKey: /** @type {string} */ (serviceRoleKey),
  };
}
