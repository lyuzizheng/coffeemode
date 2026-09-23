import "server-only";

import { appConfig } from "@/lib/config";

/**
 * Profile upsert on OAuth sign-in (spec 0001, auth-foundation slice).
 *
 * `profiles.id` is the Supabase auth user id. The first sign-in creates the
 * row; later sign-ins only refresh `last_seen_at` — a name the user edits in
 * the app must never be clobbered by provider metadata on re-login.
 *
 * Provider metadata is untrusted input: `display_name` is truncated to the
 * product cap and `avatar_url` must come from a known IdP/storage CDN host
 * (BRAWUKA-635) — anything else is stored as NULL and the UI falls back to
 * the name initial.
 */

type SupabaseUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: {
    full_name?: string;
    name?: string;
    user_name?: string;
    preferred_username?: string;
    avatar_url?: string;
    picture?: string;
  };
};

type ProfileInput = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

/**
 * Exact hosts accepted for OAuth-provided avatar URLs, plus suffix rules for
 * provider CDNs that serve from per-project/per-user subdomains (Google
 * user-content, Supabase storage). Apple ships no avatar via Sign in with
 * Apple, but its CDN hosts are admitted for the same provider-metadata path.
 */
const AVATAR_EXACT_HOSTS: Record<string, true> = {
  "googleusercontent.com": true,
  "apple.com": true,
  "icloud.com": true,
};

const AVATAR_HOST_SUFFIXES = [
  ".googleusercontent.com",
  ".supabase.co",
  ".supabase.in",
  ".apple.com",
  ".icloud.com",
  ".cdn-apple.com",
];

/** Upper bound for a stored avatar URL — `profiles.avatar_url` is `text`. */
const AVATAR_URL_MAX_CHARS = 2048;

/**
 * Returns the avatar URL when it is an `https:` URL on a known IdP/storage
 * CDN host, else `null` (reject — never re-host remote bytes at login time).
 * Suffix matching requires a `.` boundary so `googleusercontent.com.evil.com`
 * never matches.
 */
export function sanitizeAvatarUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > AVATAR_URL_MAX_CHARS) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // Benign: relative paths and malformed strings are not remote avatars.
    return null;
  }
  if (url.protocol !== "https:") return null;
  const hostname = url.hostname.toLowerCase();
  if (AVATAR_EXACT_HOSTS[hostname]) return trimmed;
  if (
    AVATAR_HOST_SUFFIXES.some(
      (suffix) => hostname.length > suffix.length && hostname.endsWith(suffix),
    )
  ) {
    return trimmed;
  }
  return null;
}

/** Derive the profile fields we store from Supabase user metadata. */
export function profileFromUser(user: SupabaseUserLike): ProfileInput {
  const meta = user.user_metadata ?? {};
  // First non-empty provider name candidate, truncated to the product
  // display-name cap (`profile.displayNameMaxChars`, the same bound PATCH
  // validation enforces). Non-string metadata values are skipped — provider
  // payloads are `any` at runtime regardless of the typed contract above.
  const max = appConfig.profile.displayNameMaxChars;
  let displayName = "A nomad";
  for (const candidate of [
    meta.full_name,
    meta.name,
    meta.user_name,
    meta.preferred_username,
    user.email?.split("@")[0],
  ]) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length === 0) continue;
    displayName = trimmed.length > max ? trimmed.slice(0, max) : trimmed;
    break;
  }

  return {
    id: user.id,
    displayName,
    avatarUrl: sanitizeAvatarUrl(meta.avatar_url ?? meta.picture ?? null),
  };
}

/** Minimal query-runner shape so the upsert is testable with a mock. */
type QueryRunner = (text: string, params: unknown[]) => Promise<unknown>;

const UPSERT_SQL = `
  insert into profiles (id, display_name, avatar_url, last_seen_at)
  values ($1, $2, $3, now())
  on conflict (id) do update set last_seen_at = now()
  returning id, (xmax = 0) as inserted
`;

/**
 * Upsert the profile row for a signed-in user. Returns whether this sign-in
 * created the row (`inserted === true` on first login).
 */
export async function upsertProfile(
  user: SupabaseUserLike,
  runQuery: QueryRunner,
): Promise<{ id: string; inserted: boolean }> {
  const input = profileFromUser(user);
  const result = (await runQuery(UPSERT_SQL, [
    input.id,
    input.displayName,
    input.avatarUrl,
  ])) as { rows: { id: string; inserted: boolean }[] };
  return { id: result.rows[0].id, inserted: result.rows[0].inserted };
}
