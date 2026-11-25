import type { NextRequest, NextResponse } from "next/server";
import { NextResponse as NextResponseClass } from "next/server";
import type { SessionUser } from "@/lib/auth/get-user";
import { getRequestId } from "@/lib/observability/server-log";
import { betaDecisionFor, recordBetaDenied } from "./access";
import { isBetaEnabled, isBetaPublicPath } from "./config";
import { expireSessionCookies } from "./session-cookies";

/**
 * Page-side closed-beta gate (BRAWUKA-970, spec 0001 §Closed beta).
 *
 * Runs in the proxy, before routing, and answers a refused page request by
 * REWRITING it to the beta surface instead of redirecting:
 *
 * - the address bar keeps the URL the visitor asked for, so a magic link's
 *   `#access_token=` fragment (BRAWUKA-956) survives — a redirect would drop
 *   it and break that sign-in path mid-flight;
 * - no redirect loop can exist between `/` and `/beta`;
 * - one branch covers anonymous, unverifiable, and refused sessions.
 *
 * API routes are NOT here: `guard()` answers those with the JSON envelope.
 * Only page navigations are gated (`GET`/`HEAD`): a refused visitor never
 * receives a rendered page to post a server action from, and every action
 * verifies its own session again.
 */

export interface BetaPageGateInput {
  /** What this request owes admission (see `betaGateScope`). */
  scope: BetaGateScope;
  /** Verified session identity. `undefined` = verification did not run or failed. */
  verifiedUser: SessionUser | null | undefined;
  /**
   * Response that already owns any refreshed session cookies. An anonymous
   * rewrite keeps them — dropping a rotated refresh token would make the next
   * request sign the browser out (BRAWUKA-315); a refusal expires them.
   */
  carry: NextResponse;
}

/** The social-card image route: an asset call wearing a page URL. */
const OG_IMAGE_PATH = /^\/cafes\/[^/]+\/og-image$/;

/**
 * What admission owes this request:
 * - `rewrite` — a gated page; a refused or anonymous visitor gets the surface.
 * - `signout` — `/beta` opened by a refused session: render the surface, but
 *   expire the session cookies so the refusal does not outlive the page.
 * - `none` — not a page the gate owns.
 */
export type BetaGateScope = "rewrite" | "signout" | "none";

/** The proxy's admission scope for one request. */
export function betaGateScope(request: NextRequest): BetaGateScope {
  if (!isBetaEnabled()) return "none";
  if (request.method !== "GET" && request.method !== "HEAD") return "none";
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) return "none";
  // `/cafes/[id]/og-image` is a route handler that answers with image bytes.
  // Rewriting it would serve beta HTML to a crawler as a social card.
  if (OG_IMAGE_PATH.test(pathname)) return "none";
  if (!isBetaPublicPath(pathname)) return "rewrite";
  return pathname === "/beta" ? "signout" : "none";
}

/**
 * The gate's answer: `null` admits the request (the proxy continues); any
 * response is the beta surface rendered in place of the requested page.
 */
export async function betaPageGate(
  request: NextRequest,
  input: BetaPageGateInput,
): Promise<NextResponse | null> {
  if (input.scope === "none") return null;

  // No identity at all — anonymous visitor, or a session the proxy could not
  // verify. Fail closed into the beta landing surface, which resolves the
  // session itself and shows either the invitation CTA or the refusal. A
  // public path (the `/beta` sign-out scope) has nothing to rewrite.
  if (!input.verifiedUser) {
    return input.scope === "rewrite"
      ? betaRewrite(request, false, input.carry)
      : null;
  }

  const decision = await betaDecisionFor(input.verifiedUser.email);
  if (decision.allowed) return null;

  recordBetaDenied({
    email: input.verifiedUser.email,
    reason: decision.reason,
    route: `${request.method} ${request.nextUrl.pathname}`,
    requestId: getRequestId(request),
  });
  const response =
    input.scope === "rewrite" ? betaRewrite(request, true, input.carry) : input.carry;
  // Automatic sign-out (BRAWUKA-970): the refused session ends with this
  // response — no manual sign-out button is required to leave the account.
  expireSessionCookies(request, response);
  return response;
}

/** Rewrite to the beta surface, keeping the browser URL (and any fragment). */
function betaRewrite(
  request: NextRequest,
  denied: boolean,
  carry: NextResponse,
): NextResponse {
  const target = request.nextUrl.clone();
  target.pathname = "/beta";
  target.search = denied ? "?denied=1" : "";
  const response = NextResponseClass.rewrite(target);
  // The surface is per-request (session state): never in a shared cache, and
  // it carries any rotated session cookies forward (a refusal expires them
  // afterwards in `betaPageGate`).
  response.headers.set("Cache-Control", "private, no-store");
  for (const cookie of carry.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  return response;
}
