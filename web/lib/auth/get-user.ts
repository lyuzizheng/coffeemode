import { logError } from "@/lib/observability/server-log";
import "server-only";

import type { User } from "@supabase/supabase-js";

import { createSupabaseServerClient, isAuthConfigured } from "./supabase-server";

/**
 * The session-user fields callers may rely on. `supabase.auth.getUser()`
 * returns the full `User` at runtime; the typed contract is the subset
 * consumers use — `id` for identity, `email`/`user_metadata` for
 * `profileFromUser` display-name fallbacks (BRAWUKA-578: stripping them
 * collapsed every initial to "A nomad" → "A").
 */
export type SessionUser = Pick<User, "id"> &
  Partial<Pick<User, "email" | "user_metadata">>;

/**
 * Returns the currently signed-in session user, or null when auth is not
 * configured or there is no active session.
 *
 * Use this in route handlers and server actions that need a lightweight session
 * check without touching the database.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  if (!isAuthConfigured()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return data.user;
  } catch (e) {
    // Network blips or Supabase outages should not crash public API routes.
    // Route handlers treat a null user as an unauthenticated caller and
    // continue with rate-limited anonymous behavior.
    logError({ route: "getCurrentUser", error: e });
    return null;
  }
}
