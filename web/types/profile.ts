/**
 * App-side user record, keyed by Supabase auth user id.
 * Mirrors `web/lib/auth/profiles.ts` and the `profiles` table.
 */
export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  current_city: string;
  last_location: unknown | null;
  last_seen_at: string | null;
  created_at: string;
  show_public_identity: boolean;
  public_handle: string | null;
  identity_consented_at: string | null;
  public_handle_changed_at: string | null;
}

/** Derived profile statistics shown on `/profile`. */
export interface ProfileStats {
  cafes_count: number;
  checkins_count: number;
  cities_count: number;
}

/** Profile row with its derived stats joined in. */
export type ProfileWithStats = Profile & ProfileStats;
