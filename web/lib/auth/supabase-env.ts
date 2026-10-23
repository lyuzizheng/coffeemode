/**
 * Supabase key contract (BRAWUKA-950).
 *
 * Supabase retired the JWT `anon` / `service_role` keys in favour of opaque
 * `sb_publishable_…` / `sb_secret_…` keys. Both map to the same Postgres roles
 * (publishable → `anon`, secret → `service_role`), so the privilege model is
 * unchanged; only the key shape and the env names moved (spec 0010 §3).
 *
 * New names are read first and the legacy names stay as a fallback while
 * deployments migrate. This module is deliberately free of `server-only`: the
 * proxy bundle imports it. Only the publishable key is public —
 * `resolveSupabaseSecretKey()` is called from server-side code only.
 */

/** Env source shape: `process.env` in production, a fixture object in tests. */
type SupabaseEnvSource = Record<string, string | undefined>;

/** Public Supabase project URL. */
export function resolveSupabaseUrl(env: SupabaseEnvSource = process.env): string | undefined {
  return env.NEXT_PUBLIC_SUPABASE_URL;
}

/** Publishable key (legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` accepted). */
export function resolveSupabasePublishableKey(
  env: SupabaseEnvSource = process.env,
): string | undefined {
  return env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

/** Server-side secret key (legacy `SUPABASE_SERVICE_ROLE_KEY` accepted). */
export function resolveSupabaseSecretKey(env: SupabaseEnvSource = process.env): string | undefined {
  return env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
}
