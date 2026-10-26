import type { NextRequest, NextResponse } from "next/server";
import { NextResponse as NextResponseClass } from "next/server";
import type { SessionUser } from "@/lib/auth/get-user";
import { getRequestId } from "@/lib/observability/server-log";
import { betaDecisionFor, recordBetaDenied } from "./access";
import { isBetaEnabled, isBetaPublicPath } from "./config";

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
  /** Verified session identity. `undefined` = verification did not run or failed. */
  verifiedUser: SessionUser | null | undefined;
  /**
   * Response that already owns any refreshed session cookies. A refusal
   * rewrites the body but keeps them — dropping a rotated refresh token would
   * make the next request sign the browser out (BRAWUKA-315).
   */
  carry: NextResponse;
}

/** The social-card image route: an asset call wearing a page URL. */
const OG_IMAGE_PATH = /^\/cafes\/[^/]+\/og-image$/;

/** True when the proxy owns this request's admission decision. */
export function isBetaGatedPage(request: NextRequest): boolean {
  if (!isBetaEnabled()) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) return false;
  // `/cafes/[id]/og-image` is a route handler that answers with image bytes.
  // Rewriting it would serve beta HTML to a crawler as a social card.
  if (OG_IMAGE_PATH.test(pathname)) return false;
  return !isBetaPublicPath(pathname);
}

/**
 * The gate's answer: `null` admits the request (the proxy continues); any
 * response is the beta surface rendered in place of the requested page.
 */
export async function betaPageGate(
  request: NextRequest,
  input: BetaPageGateInput,
): Promise<NextResponse | null> {
  if (!isBetaGatedPage(request)) return null;

  // No identity at all — anonymous visitor, or a session the proxy could not
  // verify. Fail closed into the beta landing surface, which resolves the
  // session itself and shows either the invitation CTA or the refusal.
  if (!input.verifiedUser) {
    return betaRewrite(request, false, input.carry);
  }

  const decision = await betaDecisionFor(input.verifiedUser.email);
  if (decision.allowed) return null;

  recordBetaDenied({
    email: input.verifiedUser.email,
    reason: decision.reason,
    route: `${request.method} ${request.nextUrl.pathname}`,
    requestId: getRequestId(request),
  });
  return betaRewrite(request, true, input.carry);
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
  // it carries any rotated session cookies forward.
  response.headers.set("Cache-Control", "private, no-store");
  for (const cookie of carry.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  return response;
}
