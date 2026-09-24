/**
 * Supabase-mock session minting for E2E gates (BRAWUKA-704, extracted from
 * `lib/checkin-submit-gate.mjs`).
 *
 * The session cookie follows the @supabase/ssr storage key:
 * `sb-<first host label>-auth-token`, derived from `E2E_SUPABASE_URL`. A
 * misconfigured URL (wrong host) therefore mints a valid token but plants it
 * under a name the app never reads — the gate would run anonymously and fail
 * late at an unrelated assertion. `assertSessionLanded` closes that trap:
 * after planting the cookie it probes an authenticated-only endpoint and
 * fails fast naming the URL when the session did not land.
 */
import { assert } from "./gate-assert.mjs";

/** @supabase/ssr storage key for a mock URL: `sb-<first host label>-auth-token`. */
export function supabaseCookieName(supabaseUrl) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/**
 * Mint a session at the supabase-mock and return the @supabase/ssr cookie
 * pair. Returns null when the mock is unreachable — the caller degrades to
 * a skip instead of failing the whole suite.
 */
export async function mintSession(supabaseUrl, userId) {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "e2e@coffeemode.test", userId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: data.user,
    };
    return {
      name: supabaseCookieName(supabaseUrl),
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    };
  } catch {
    return null;
  }
}

/**
 * Fail fast when the planted session did not land (wrong cookie name from a
 * misconfigured `E2E_SUPABASE_URL`, expired mock token, ...). Probes the
 * auth-gated navigations prompt: 401 is the contract's anonymous answer.
 */
export async function assertSessionLanded({ base, supabaseUrl, request, label }) {
  const probe = await request.get(`${base}/api/navigations/prompt`, {
    headers: { Origin: base },
  });
  assert(
    probe.status() !== 401,
    `${label}: session cookie did not land (prompt probe at ${base} returned 401) — ` +
      `E2E_SUPABASE_URL=${supabaseUrl} derives the cookie name ${supabaseCookieName(supabaseUrl)}; ` +
      `a wrong host label silently yields an anonymous session`,
  );
}
