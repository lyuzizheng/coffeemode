import type { SessionUser } from "./get-user";

/**
 * Proxy → page verified-user handoff (BRAWUKA-644).
 *
 * The proxy runs `auth.getUser()` on cafe GET/HEAD requests and forwards the
 * verified identity on this header; the page needs the same identity for
 * `loadMapSession`. Without this header the page re-verifies over the
 * network — two `getUser()` calls per signed-in cafe page view.
 *
 * The header carries only display-relevant identity fields (id, email, and
 * the `profileFromUser` display-name/avatar candidates) — never the full
 * User object. Phone, provider tokens, app_metadata, and unknown provider
 * claims stay out of request headers.
 *
 * Wire format (BRAWUKA-723): `"v1." + base64url(JSON allowlist payload)`, or
 * the literal `null` for a verified-anonymous result. Raw JSON was never
 * ASCII-safe — Chinese and emoji provider names made `Headers.set` throw a
 * `TypeError` outside the getUser try/catch, 500ing signed-in cafe pages —
 * so base64url keeps every value in the header alphabet. The `v1.` prefix
 * separates this wire from the retired raw-JSON format, which decoders
 * reject outright.
 *
 * Bounds: metadata strings are capped at encode time (names 128 chars,
 * avatar URLs 2048), and the whole value at 8 KiB — an oversized identity
 * refuses to encode instead of throwing into the proxy, and the page falls
 * back to its own `getUser()`.
 *
 * Trust: the proxy strips inbound copies before routing, so only a value it
 * set itself ever reaches a page. This module is imported by BOTH the proxy
 * bundle and server bundles — keep it free of `server-only`, `next/*`, and
 * supabase imports (types only), and free of `Buffer` (the TextEncoder +
 * `btoa`/`atob` pair works in the proxy bundle too).
 */
export const VERIFIED_USER_HEADER = "x-verified-user";

/** Wire version prefix — decoders reject values without it. */
const WIRE_VERSION_PREFIX = "v1.";

/** Upper bound for the whole header value (server header limits sit ~8 KiB). */
const MAX_HEADER_CHARS = 8192;

/** User ids are UUIDs; the cap only stops pathological values. */
const MAX_ID_CHARS = 256;

/** RFC 5321 caps an address at 254 chars; 320 leaves headroom. */
const MAX_EMAIL_CHARS = 320;

/** Provider display-name candidates — truncated, never dropped, at encode. */
const MAX_NAME_CHARS = 128;

/** Matches the stored-avatar bound `profiles.ts` enforces downstream. */
const MAX_AVATAR_URL_CHARS = 2048;
/** Metadata keys the page needs for display-name/avatar fallbacks. */
const NAME_METADATA_KEYS = ["full_name", "name", "user_name", "preferred_username"] as const;
/** Metadata keys the page needs for avatar fallbacks. */
const AVATAR_METADATA_KEYS = ["avatar_url", "picture"] as const;
/** base64url-encode UTF-8 text without `Buffer` (proxy-bundle safe). */
function base64UrlEncodeText(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** base64url-decode to UTF-8 text; `null` on any malformed input. */
function base64UrlDecodeText(raw: string): string | null {
  if (!/^[A-Za-z0-9\-_]+$/.test(raw)) return null;
  try {
    const binary = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
/** Copy one capped string field; non-strings and empties are dropped. */
function copyCappedString(
  source: Record<string, unknown>,
  key: string,
  max: number,
  truncate: boolean,
  out: Record<string, string>,
): void {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) return;
  // Display names keep their informative prefix; a truncated avatar URL is
  // a locator that points nowhere, so over-long URLs are dropped outright.
  if (value.length > max && !truncate) return;
  out[key] = value.length > max ? value.slice(0, max) : value;
}

/**
 * Reduce arbitrary provider metadata to the display allowlist, capped.
 * Returns `undefined` when nothing display-relevant survives.
 */
function toHeaderMetadata(meta: unknown): Record<string, string> | undefined {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return undefined;
  // Boundary: provider payloads are `any` at runtime; the allowlist below
  // re-validates every field it keeps, so the record view is only a reader.
  const source = meta as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of NAME_METADATA_KEYS) copyCappedString(source, key, MAX_NAME_CHARS, true, out);
  for (const key of AVATAR_METADATA_KEYS) copyCappedString(source, key, MAX_AVATAR_URL_CHARS, false, out);
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Serialize the verified result for the request header. ASCII-safe for any
 * Unicode display name. Throws only for a missing id or an oversized
 * identity — callers (the proxy) treat that as "skip the header" so the
 * page falls back to its own `getUser()`.
 */
export function encodeVerifiedUser(user: SessionUser | null): string {
  if (!user) return "null";
  if (typeof user.id !== "string" || user.id.length === 0 || user.id.length > MAX_ID_CHARS) {
    throw new Error("verified-user identity missing user id");
  }
  const payload: Record<string, unknown> = { id: user.id };
  if (typeof user.email === "string" && user.email.length > 0 && user.email.length <= MAX_EMAIL_CHARS) {
    payload.email = user.email;
  }
  const metadata = toHeaderMetadata(user.user_metadata);
  if (metadata) payload.user_metadata = metadata;
  const encoded = WIRE_VERSION_PREFIX + base64UrlEncodeText(JSON.stringify(payload));
  if (encoded.length > MAX_HEADER_CHARS) {
    throw new Error("verified-user identity exceeds header budget");
  }
  return encoded;
}

/**
 * Parse the header value.
 * - `undefined` — absent or malformed: not verified, caller must fall back.
 * - `null` — verified anonymous.
 * - `SessionUser` — verified user.
 */
export function decodeVerifiedUser(raw: string | null): SessionUser | null | undefined {
  if (raw === null) return undefined;
  if (raw === "null") return null;
  if (!raw.startsWith(WIRE_VERSION_PREFIX) || raw.length > MAX_HEADER_CHARS) return undefined;
  const json = base64UrlDecodeText(raw.slice(WIRE_VERSION_PREFIX.length));
  if (json === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  // Boundary: the wire payload is validated field-by-field below; only the
  // allowlisted, capped fields reach the returned identity.
  const record = parsed as Record<string, unknown>;
  const id = record["id"];
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_CHARS) return undefined;
  const email = record["email"];
  return {
    id,
    email:
      typeof email === "string" && email.length > 0 && email.length <= MAX_EMAIL_CHARS
        ? email
        : undefined,
    user_metadata: toHeaderMetadata(record["user_metadata"]),
  };
}

/**
 * Encode and stamp the header; `false` (never a throw) when the identity is
 * oversized — the proxy then forwards without the header and the page falls
 * back to its own `getUser()`. A failed attempt leaves no stale value.
 */
export function trySetVerifiedUserHeader(headers: Headers, user: SessionUser | null): boolean {
  try {
    headers.set(VERIFIED_USER_HEADER, encodeVerifiedUser(user));
  } catch {
    headers.delete(VERIFIED_USER_HEADER);
    return false;
  }
  return true;
}

/**
 * Delete an inbound copy so a client-supplied value can never authorize a
 * request. The proxy runs this before routing; only its own value — set
 * after stripping — ever reaches a page.
 */
export function stripInboundVerifiedUser(headers: Headers): void {
  headers.delete(VERIFIED_USER_HEADER);
}
