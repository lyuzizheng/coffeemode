import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { readJsonBody } from "@/lib/api/guard";
import { completeSignIn } from "@/lib/auth/sign-in-completion";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { logError } from "@/lib/observability/server-log";

export const runtime = "nodejs";

/**
 * Establishes the session a magic link left in the URL hash (BRAWUKA-956).
 *
 * Supabase's hosted `/auth/v1/verify` answers a link without a PKCE challenge
 * with a 303 to `#access_token=…&refresh_token=…`; a fragment never reaches
 * the server, so `/auth/callback` cannot exchange it. The landing page's
 * HashSessionBridge posts the pair here, and the server-side `@supabase/ssr`
 * client turns it into the same session cookies the OAuth flow writes.
 *
 * Deliberately server-side: `@supabase/supabase-js` is ~300 KB in the client
 * bundle, which the app-wide magic-link listener cannot afford (bundle
 * budget, DG107). The browser only posts two opaque strings.
 *
 * `origin` + the `identity-write` bucket bound abuse: this endpoint hands out
 * a session cookie to whoever presents a valid token pair.
 */
export const POST = apiRoute(
  {
    bucket: "identity-write",
    auth: "optional",
    origin: true,
    route: "POST /api/auth/session",
    // Admission cannot exist before this route runs: `completeSignIn` is the
    // closed-beta gate itself (BRAWUKA-970) and refuses a non-allowlisted
    // identity with 403 `beta_not_allowed`.
    betaExempt: true,
  },
  async (request, ctx) => {
    const body = await readJsonBody<{ access_token?: unknown; refresh_token?: unknown }>(
      request,
      { requestId: ctx.requestId },
    );
    if (!body.ok) return body.response;

    const accessToken = body.data?.access_token;
    const refreshToken = body.data?.refresh_token;
    if (
      typeof accessToken !== "string" ||
      typeof refreshToken !== "string" ||
      accessToken === "" ||
      refreshToken === ""
    ) {
      return apiError("invalid_request", "access_token and refresh_token are required", {
        status: 400,
        requestId: ctx.requestId,
      });
    }

    const supabase = await createSupabaseServerClient();
    // setSession verifies the bearer against Supabase before storing it, so a
    // forged or expired pair never becomes a cookie. A malformed JWT throws
    // inside auth-js rather than returning an error — both are a rejection.
    let user: User | null = null;
    let failure: unknown = null;
    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error || !data.user) failure = error ?? "no user returned";
      else user = data.user;
    } catch (err) {
      failure = err;
    }

    if (!user) {
      // Never swallow: a rejected pair is a real login failure (expired link,
      // replayed token) and belongs in the log next to the 401.
      logError({
        route: ctx.route,
        request,
        status: 401,
        code: "unauthorized",
        error: failure,
      });
      return apiError("unauthorized", 401, { requestId: ctx.requestId });
    }

    const completed = await completeSignIn({ request, supabase, user, route: ctx.route });
    if (completed === "beta_denied") {
      // The session this request just created has been destroyed again; the
      // client must land on the beta surface, not on an auth-error banner.
      return apiError("beta_not_allowed", 403, { requestId: ctx.requestId });
    }
    if (completed !== "ok") {
      return apiError("internal_error", 500, { requestId: ctx.requestId });
    }

    return new NextResponse(null, { status: 204 });
  },
);
