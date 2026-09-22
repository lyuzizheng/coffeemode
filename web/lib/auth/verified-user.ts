import type { SessionUser } from "./get-user";

/**
 * Proxy → page verified-user handoff (BRAWUKA-644).
 *
 * The proxy already runs `auth.getUser()` on cafe GET/HEAD requests for the
 * gone-cafe visibility probe; the page then needs the same verified identity
 * for `loadMapSession`. Without this header the page re-verifies over the
 * network — two `getUser()` calls per signed-in cafe page view.
 *
 * The header carries only the `SessionUser` contract fields (id + the
 * email/user_metadata display-name fallbacks), never the full User object —
 * phone, provider tokens, and app_metadata stay out of request headers.
 *
 * Wire format: JSON `{"id","email","user_metadata"}`, or the literal `null`
 * for a verified-anonymous result. Absent header = the proxy did not verify
 * (non-cafe route, no session cookie, or getUser threw) and the consumer
 * falls back to its own `getUser()`.
 *
 * Trust: the proxy strips inbound copies before routing, so only a value it
 * set itself ever reaches a page. This module is imported by BOTH the proxy
 * bundle and server bundles — keep it free of `server-only`, `next/*`, and
 * supabase imports (types only).
 */
export const VERIFIED_USER_HEADER = "x-verified-user";

/** Serialize the verified result for the request header. */
export function encodeVerifiedUser(user: SessionUser | null): string {
  if (!user) return "null";
  return JSON.stringify({
    id: user.id,
    email: user.email,
    user_metadata: user.user_metadata,
  });
}

/**
 * Parse the header value.
 * - `undefined` — absent or malformed: not verified, caller must fall back.
 * - `null` — verified anonymous.
 * - `SessionUser` — verified user.
 */
export function decodeVerifiedUser(
  raw: string | null,
): SessionUser | null | undefined {
  if (raw === null) return undefined;
  if (raw === "null") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { id, email, user_metadata } = parsed as Record<string, unknown>;
    if (typeof id !== "string") return undefined;
    return {
      id,
      email: typeof email === "string" ? email : undefined,
      user_metadata:
        typeof user_metadata === "object" && user_metadata !== null
          ? (user_metadata as SessionUser["user_metadata"])
          : undefined,
    };
  } catch {
    return undefined;
  }
}
