import "server-only";

import { createSupabaseServerClient, isAuthConfigured } from "./supabase-server";

/**
 * Returns the currently signed-in user id, or null when auth is not configured
 * or there is no active session.
 *
 * Use this in route handlers and server actions that need a lightweight session
 * check without touching the database.
 */
export async function getCurrentUser(): Promise<{ id: string } | null> {
  if (!isAuthConfigured()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id };
  } catch (e) {
    // Network blips or Supabase outages should not crash public API routes.
    // Route handlers treat a null user as an unauthenticated caller and
    // continue with rate-limited anonymous behavior.
    console.error("getCurrentUser failed:", e);
    return null;
  }
}
