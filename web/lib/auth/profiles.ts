/**
 * Profile upsert on OAuth sign-in (spec 0001, auth-foundation slice).
 *
 * `profiles.id` is the Supabase auth user id. The first sign-in creates the
 * row; later sign-ins only refresh `last_seen_at` — a name the user edits in
 * the app must never be clobbered by provider metadata on re-login.
 */

export type SupabaseUserLike = {
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

export type ProfileInput = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

/** Derive the profile fields we store from Supabase user metadata. */
export function profileFromUser(user: SupabaseUserLike): ProfileInput {
  const meta = user.user_metadata ?? {};
  const displayName =
    meta.full_name ??
    meta.name ??
    meta.user_name ??
    meta.preferred_username ??
    user.email?.split("@")[0] ??
    "Nomad";

  return {
    id: user.id,
    displayName,
    avatarUrl: meta.avatar_url ?? meta.picture ?? null,
  };
}

/** Minimal query-runner shape so the upsert is testable with a mock. */
export type QueryRunner = (text: string, params: unknown[]) => Promise<unknown>;

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
