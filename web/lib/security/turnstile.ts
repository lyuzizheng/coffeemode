import "server-only";

import { getAllowedHosts } from "@/lib/security/origin";

/**
 * Cloudflare Turnstile server-side verification (BRAWUKA-239).
 *
 * Anonymous `POST /api/places/resolve` triggers worker-side Google Maps short-link
 * resolution (billable), so every call must carry a fresh `cf-turnstile-response`
 * token minted by the `places-resolve` widget. BRAWUKA-233 rejected WAF Managed
 * Challenge here (challenge HTML breaks `fetch()` callers); Turnstile verifies
 * programmatically via siteverify instead.
 *
 * Fail-closed: missing/oversized token, siteverify network error / non-2xx /
 * non-JSON, `success !== true`, action mismatch, or hostname outside the
 * deployment allowlist all reject. The single exception is an unconfigured
 * secret outside production (dev/test convenience) — production without
 * `TURNSTILE_SECRET_KEY` rejects with `turnstile_not_configured`.
 */

export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Stable widget action for the maps-link resolve surface (1-32 chars, [a-z0-9_-]). */
export const TURNSTILE_ACTION_PLACES_RESOLVE = "places-resolve";

const MAX_TOKEN_LENGTH = 2048;
const SITEVERIFY_TIMEOUT_MS = 10_000;

export type TurnstileFailureCode =
  | "turnstile_required"
  | "turnstile_rejected"
  | "turnstile_unavailable"
  | "turnstile_not_configured";

export type TurnstileResult = { ok: true } | { ok: false; code: TurnstileFailureCode; message: string };

interface SiteverifyResult {
  success?: boolean;
  action?: string;
  hostname?: string;
}

/**
 * Hostnames a siteverify `hostname` may match: the deployment allowlist
 * (`NEXT_PUBLIC_SITE_URL` + `NEXT_PUBLIC_ALLOWED_HOSTS`, via `getAllowedHosts`)
 * plus the request's own `host` (the frontend the caller is on). Never
 * consults `x-forwarded-host`: client-injectable on every deployment here
 * (BRAWUKA-282 P1-1 — Cloudflare never sets it, no edge strips it).
 * Falls back to loopback when nothing is configured, mirroring `isSameOrigin`
 * dev behavior. Production allowlists never include loopback — configure
 * `NEXT_PUBLIC_SITE_URL`.
 */
function expectedHostnames(request: Request): Set<string> {
  const names = new Set<string>();
  for (const host of getAllowedHosts()) {
    const hostname = host.split(":")[0]?.trim().toLowerCase();
    if (hostname) names.add(hostname);
  }
  const effective = request.headers.get("host")?.trim();
  if (effective) {
    try {
      names.add(new URL(`http://${effective}`).hostname.toLowerCase());
    } catch {
      // Benign: malformed Host header contributes nothing to the allowlist.
    }
  }
  if (names.size === 0) {
    names.add("localhost");
    names.add("127.0.0.1");
  }
  return names;
}

/**
 * Verify a Turnstile token against siteverify. Never throws — every failure
 * mode resolves to `{ ok: false }` so callers map it straight to 403.
 */
export async function verifyTurnstileToken(
  token: unknown,
  request: Request,
  action: string = TURNSTILE_ACTION_PLACES_RESOLVE,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        code: "turnstile_not_configured",
        message: "bot verification is not configured",
      };
    }
    console.warn("[turnstile] TURNSTILE_SECRET_KEY unset — skipping verification outside production");
    return { ok: true };
  }

  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return {
      ok: false,
      code: "turnstile_required",
      message: "bot verification required, please retry",
    };
  }

  let result: SiteverifyResult;
  try {
    const body = new URLSearchParams({ secret, response: token });
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwardedFor) body.set("remoteip", forwardedFor);
    const res = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    result = (await res.json()) as SiteverifyResult;
  } catch {
    // Network error, non-2xx, timeout, or non-JSON body: fail closed.
    return {
      ok: false,
      code: "turnstile_unavailable",
      message: "bot verification unavailable, please retry",
    };
  }

  const hostname = typeof result?.hostname === "string" ? result.hostname.toLowerCase() : "";
  if (result?.success !== true || result?.action !== action || !expectedHostnames(request).has(hostname)) {
    return {
      ok: false,
      code: "turnstile_rejected",
      message: "bot verification failed, please retry",
    };
  }
  return { ok: true };
}
