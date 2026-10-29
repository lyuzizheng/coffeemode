import { apiError } from "@/lib/api/response";
import { completeSignIn } from "@/lib/auth/sign-in-completion";
import { logError } from "@/lib/observability/server-log";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { isSafeReturnPath } from "@/lib/auth/safe-path";
import { redirectToPath } from "@/lib/security/origin";

export const runtime = "nodejs";

/**
 * Email OTP types `verifyOtp` accepts (`EmailOtpType` in auth-js). A magic
 * link generated server-side (Admin API `generateLink`) carries `token_hash` +
 * `type` instead of a PKCE code, so this route is the only place that can turn
 * it into a session cookie (BRAWUKA-956).
 */
const OTP_TYPES = ["magiclink", "email", "signup", "recovery", "invite", "email_change"] as const;
type OtpType = (typeof OTP_TYPES)[number];

/**
 * Refusal destination (BRAWUKA-970): a non-allowlisted identity is signed out
 * and lands on the beta surface with the refusal copy — never on the generic
 * auth-error banner, which would invite a retry that cannot succeed.
 */
const BETA_DENIED_PATH = "/beta?denied=1";

function isOtpType(value: string): value is OtpType {
  return (OTP_TYPES as readonly string[]).includes(value);
}

/**
 * Auth redirect target. Both flows converge here: PKCE links arrive with
 * `?code=`, server-generated links with `?token_hash=&type=`. Either way the
 * session is written as `@supabase/ssr` cookies and the Postgres profile row
 * is upserted before the user returns to the app.
 *
 * Both successes go through redirectToPath: `request.url`'s origin is the
 * internal listener (`http://0.0.0.0:3000`) behind the staging proxy, not the
 * public site (BRAWUKA-558).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.has("token_hash") || searchParams.has("type")) {
    return magicLinkCallback(request, searchParams);
  }

  if (!searchParams.get("code")) {
    // Nothing to exchange. A browser navigation can still carry the session in
    // the URL hash (Supabase's verify endpoint 303s there for non-PKCE links);
    // the home page's HashSessionBridge consumes it, so send the browser to `/`
    // rather than failing a login that is about to succeed. A provider-reported
    // error is the one case that gets the error banner.
    return redirectToPath(request, searchParams.has("error") ? "/?auth=error" : "/");
  }

  return oauthCallback(request, searchParams);
}

/** `?token_hash=&type=` — the email-OTP half of the redirect contract. */
async function magicLinkCallback(request: Request, searchParams: URLSearchParams) {
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // A half-specified OTP callback is a broken link, not a login attempt:
  // answer 400 instead of redirecting into a session that cannot exist.
  if (!tokenHash || !type) {
    return apiError("invalid_request", "token_hash and type are both required", {
      status: 400,
    });
  }
  if (!isOtpType(type)) {
    return apiError("invalid_request", "unsupported otp type", { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.user) {
    // Never swallow: an expired or replayed link is a real login failure and
    // belongs in the log next to the redirect the user sees.
    logError({
      route: "GET /auth/callback verify-otp",
      request,
      error: error ?? "no user returned",
    });
    return redirectToPath(request, "/?auth=error");
  }

  const completed = await completeSignIn({
    request,
    supabase,
    user: data.user,
    route: "GET /auth/callback",
  });
  if (completed === "beta_denied") {
    return redirectToPath(request, BETA_DENIED_PATH);
  }
  if (completed !== "ok") {
    return redirectToPath(request, "/?auth=error&reason=profile_upsert");
  }

  // 302: the hosted verify chain is a GET-to-GET hop and the session is
  // already in the cookie jar; the landing page only needs a fresh render.
  const next = searchParams.get("next");
  return redirectToPath(request, isSafeReturnPath(next) ? next : "/", 302);
}

/** `?code=` — the OAuth PKCE half of the redirect contract. */
async function oauthCallback(request: Request, searchParams: URLSearchParams) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(
    searchParams.get("code") ?? "",
  );

  if (error || !data.user) {
    return redirectToPath(request, "/?auth=error");
  }

  const completed = await completeSignIn({
    request,
    supabase,
    user: data.user,
    route: "GET /auth/callback",
  });
  if (completed === "beta_denied") {
    return redirectToPath(request, BETA_DENIED_PATH);
  }
  if (completed !== "ok") {
    return redirectToPath(request, "/?auth=error&reason=profile_upsert");
  }

  const next = searchParams.get("next");
  return redirectToPath(request, isSafeReturnPath(next) ? next : "/");
}
