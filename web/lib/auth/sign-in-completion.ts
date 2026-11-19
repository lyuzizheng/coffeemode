import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { upsertProfile } from "@/lib/auth/profiles";
import { query } from "@/lib/db/postgres";
import { betaDecisionFor, recordBetaDenied } from "@/lib/beta/access";
import { isBetaEnabled } from "@/lib/beta/config";
import { recordLogin } from "@/lib/observability/metrics";
import { logError } from "@/lib/observability/server-log";

/**
 * Session-establishment tail shared by both auth entry points (BRAWUKA-956):
 * `GET /auth/callback` (PKCE code or email OTP) and `POST /api/auth/session`
 * (magic-link tokens read from the URL hash). Either way the Supabase session
 * already exists in the cookie jar; what remains is admission and the profile
 * row.
 */

interface CompleteSignInInput {
  request: Request;
  supabase: SupabaseClient;
  user: User;
  /** Log label of the calling route, e.g. `"GET /auth/callback"`. */
  route: string;
}

/**
 * Outcome of the tail. `beta_denied` is a refusal, not a failure: the session
 * is destroyed and the caller sends the visitor to the beta surface — retrying
 * the same account cannot help, so it must not look like an auth error.
 */
export type SignInCompletion = "ok" | "profile_failed" | "beta_denied";

/**
 * Admit the identity, upsert the profile row, count the login.
 *
 * Closed-beta admission runs FIRST (BRAWUKA-970): a refused address must not
 * acquire a profile row, and the session it arrived with must be destroyed
 * before it can call anything — the sign-out below is what leaves no usable
 * account behind. `profile_failed` keeps its old behavior: a transient
 * Postgres failure after a successful Supabase round-trip signs the user back
 * out so they never hold an active session with no profile; the next sign-in
 * runs this tail again.
 */
export async function completeSignIn({
  request,
  supabase,
  user,
  route,
}: CompleteSignInInput): Promise<SignInCompletion> {
  if (isBetaEnabled()) {
    const decision = await betaDecisionFor(user.email);
    if (!decision.allowed) {
      recordBetaDenied({
        email: user.email,
        reason: decision.reason,
        route: `${route} beta-gate`,
      });
      await abandonSession({ request, supabase, route });
      return "beta_denied";
    }
  }

  try {
    await upsertProfile(user, query);
  } catch (err) {
    logError({ route: `${route} profile-upsert`, request, error: err });
    await abandonSession({ request, supabase, route });
    return "profile_failed";
  }

  // Only now is it a login: the credentials verified, the address was
  // admitted, *and* the profile row landed. A tail that fails either step
  // signs the user back out above, so counting there would report sessions
  // that never existed (BRAWUKA-609).
  recordLogin();
  return "ok";
}

/** Destroy the just-established session; a failure is logged, never thrown. */
async function abandonSession({
  request,
  supabase,
  route,
}: Pick<CompleteSignInInput, "request" | "supabase" | "route">): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch (signOutError) {
    logError({ route: `${route} sign-out`, request, error: signOutError });
  }
}
