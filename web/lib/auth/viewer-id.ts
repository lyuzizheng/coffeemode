/**
 * Client-side viewer identity for cache scoping (BRAWUKA-573).
 *
 * The app has no browser Supabase client — sessions live in the
 * `sb-<ref>-auth-token` cookie written by @supabase/ssr (httpOnly: false,
 * so `document.cookie` can read it). This module decodes just enough of
 * that cookie to answer "which user owns this browser session" for the
 * IndexedDB query persister. It never validates the token — the value is
 * only a cache-ownership tag; every data read still goes through
 * server-verified routes.
 */

const AUTH_TOKEN_RE = /^sb-.+-auth-token$/;

/** Decoded session shapes seen in the wild: @supabase/ssr writes the full
 * session JSON (`base64-`-prefixed or raw); older hand-set cookies may hold
 * a bare JWT (`sb-access-token`). */
function decodeBase64Url(value: string): string | null {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function jwtSub(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  const json = decodeBase64Url(payload);
  if (!json) return null;
  try {
    const claims: unknown = JSON.parse(json);
    if (typeof claims === "object" && claims !== null) {
      const sub = (claims as { sub?: unknown }).sub;
      if (typeof sub === "string" && sub) return sub;
    }
  } catch {
    // fall through
  }
  return null;
}

function sessionJsonUserId(session: unknown): string | null {
  if (typeof session !== "object" || session === null) return null;
  const user = (session as { user?: unknown }).user;
  if (typeof user === "object" && user !== null) {
    const id = (user as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }
  const accessToken = (session as { access_token?: unknown }).access_token;
  return typeof accessToken === "string" ? jwtSub(accessToken) : null;
}

function sessionUserId(raw: string): string | null {
  let value = raw;
  try {
    value = decodeURIComponent(value);
  } catch {
    // Not percent-encoded — use as-is.
  }
  if (value.startsWith("base64-")) {
    const decoded = decodeBase64Url(value.slice("base64-".length));
    if (decoded === null) return null;
    value = decoded;
  }
  try {
    const id = sessionJsonUserId(JSON.parse(value));
    if (id) return id;
  } catch {
    // Not JSON — maybe a bare JWT.
  }
  return jwtSub(value);
}

function parseCookieHeader(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name) cookies.set(name, part.slice(eq + 1).trim());
  }
  return cookies;
}

/**
 * Returns the current viewer's user id, or null for anonymous sessions.
 * Reads `document.cookie` by default; pass a `Cookie`-header string in
 * tests/edge contexts. Malformed or absent cookies yield null — callers
 * treat null as "anonymous owner", never as an error.
 */
export function getViewerIdFromCookies(cookieHeader?: string): string | null {
  const header =
    cookieHeader ?? (typeof document === "undefined" ? "" : document.cookie);
  if (!header) return null;

  const cookies = parseCookieHeader(header);

  // Chunked session: @supabase/ssr splits oversized values into
  // `name.0`, `name.1`, … and removes the base cookie, so candidate bases
  // come from both bare names and chunk prefixes.
  const bases = new Set<string>();
  for (const name of cookies.keys()) {
    if (AUTH_TOKEN_RE.test(name)) {
      bases.add(name);
      continue;
    }
    const chunk = /^(sb-.+-auth-token)\.\d+$/.exec(name);
    if (chunk) bases.add(chunk[1]);
  }
  for (const name of bases) {
    const id = sessionUserId(authTokenValue(cookies, name));
    if (id) return id;
  }

  // Legacy bare-JWT cookie (`sb-access-token`), kept for hand-set sessions.
  const legacy = cookies.get("sb-access-token");
  if (legacy) return sessionUserId(legacy);

  return null;
}

/** Joins `name.0`, `name.1`, … chunks when present, else the bare cookie. */
function authTokenValue(cookies: Map<string, string>, name: string): string {
  const chunks: string[] = [];
  for (let i = 0; cookies.has(`${name}.${i}`); i += 1) {
    chunks.push(cookies.get(`${name}.${i}`)!);
  }
  return chunks.length > 0 ? chunks.join("") : (cookies.get(name) ?? "");
}
