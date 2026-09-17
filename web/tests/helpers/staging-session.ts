import { randomUUID } from "node:crypto";

/**
 * Staging-journey real-session helper (spec 0010 §3, spec 0003 §Test policy).
 *
 * Staging journey suites acquire REAL Supabase sessions non-interactively: a
 * per-run test user is created through the Auth Admin API with the staging
 * `service_role` key, a session is obtained via password grant, and the user
 * is deleted in `afterAll`. Interactive Google OAuth stays manual + staging
 * smoke — never automation.
 *
 * `service_role` boundary: read ONLY from the server-side
 * `SUPABASE_SERVICE_ROLE_KEY` env var. It MUST NOT appear in any
 * `NEXT_PUBLIC_*` variable, committed file, or client bundle (spec 0010 §3).
 * There are no defaults and no target guessing — missing env throws.
 *
 * This path is strictly separate from the unit-test mock path
 * (`fakeJwt` + `mockSupabaseServerClient` in `./auth`): journey suites use
 * this module, unit tests use that one, never both.
 */

export interface StagingSessionEnv {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

/**
 * Resolve the staging-session env contract. Throws listing every missing
 * variable — never defaults, never guesses a target (same vocabulary as
 * `run-staging-journey.sh`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
 * `SUPABASE_ANON_KEY`, with the public `NEXT_PUBLIC_*` mirrors accepted for
 * the non-secret URL/anon pair only).
 */
export function resolveStagingSessionEnv(
  env: Record<string, string | undefined> = process.env,
): StagingSessionEnv {
  const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !supabaseUrl ? "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)" : null,
    !anonKey ? "SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)" : null,
    !serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY (server-side only, never NEXT_PUBLIC_*)" : null,
  ].filter((entry): entry is string => entry !== null);
  if (missing.length > 0) {
    throw new Error(`Staging test session is not configured. Missing: ${missing.join(", ")}.`);
  }
  return {
    supabaseUrl: (supabaseUrl as string).replace(/\/+$/, ""),
    anonKey: anonKey as string,
    serviceRoleKey: serviceRoleKey as string,
  };
}

export interface StagingTestSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  /** Delete the test user (Admin API). Tolerates 404 — safe for `afterAll`. */
  dispose: () => Promise<void>;
}

export interface StagingSessionOptions {
  fetchImpl?: typeof fetch;
  /** Local part of the per-run test-user email. Defaults to `staging-journey`. */
  emailPrefix?: string;
  /** Password for the test user. Defaults to a random value (never logged). */
  password?: string;
}

function sessionError(op: string, status: number, body: string): Error {
  return new Error(`Staging test session ${op} failed (HTTP ${status}): ${body.slice(0, 500)}`);
}

async function readFailure(res: Response, op: string): Promise<never> {
  const body = await res.text().catch(() => "");
  throw sessionError(op, res.status, body);
}

async function createAdminUser(
  env: StagingSessionEnv,
  email: string,
  password: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const res = await fetchImpl(`${env.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) await readFailure(res, "create user");
  const data = (await res.json()) as { id?: string; user?: { id?: string } };
  const userId = data.user?.id ?? data.id;
  if (!userId) throw new Error("Staging test session create user returned no user id.");
  return userId;
}

async function signInWithPassword(
  env: StagingSessionEnv,
  email: string,
  password: string,
  fetchImpl: typeof fetch,
): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number }> {
  const res = await fetchImpl(`${env.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) await readFailure(res, "password grant");
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string | null;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error("Staging test session password grant returned no access token.");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in ?? 3600,
  };
}

/**
 * Delete a staging test user. A 404 (already deleted) resolves — `afterAll`
 * cleanup must not fail the suite on a second run.
 */
export async function deleteStagingTestUser(
  env: StagingSessionEnv,
  userId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  const res = await fetchImpl(`${env.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
    },
  });
  if (res.status === 404) return;
  if (!res.ok) await readFailure(res, "delete user");
}

/**
 * Create a per-run staging test user and sign it in. Returns the real
 * session plus `dispose` for `afterAll` deletion. Every network call goes
 * through `fetchImpl` (default: global fetch) so contract tests can stub
 * the Supabase boundary without touching real staging.
 */
export async function createStagingTestSession(
  resolved: StagingSessionEnv,
  options: StagingSessionOptions = {},
): Promise<StagingTestSession> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const email = `${options.emailPrefix ?? "staging-journey"}+${randomUUID().replaceAll("-", "")}@coffeemode.test`;
  const password = options.password ?? `${randomUUID().replaceAll("-", "")}-${randomUUID().replaceAll("-", "")}`;
  const userId = await createAdminUser(resolved, email, password, fetchImpl);
  const session = await signInWithPassword(resolved, email, password, fetchImpl);
  return {
    userId,
    email,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresIn: session.expiresIn,
    dispose: () => deleteStagingTestUser(resolved, userId, fetchImpl),
  };
}
