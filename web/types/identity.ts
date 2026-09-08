/**
 * Public author attribution projection.
 * Snake_case, consistent with PublicCheckIn and PublicCafeDetail.
 * Exposes safe public attributes only — never internal user UUIDs.
 */
export interface PublicAuthor {
  handle: string;
  display_name: string;
  avatar_url: string | null;
}

/**
 * Raw consented-author columns projected by public read SQL (spec 0006 Q5/Q8).
 * All null unless the author's profile has `show_public_identity`; the join
 * key (internal UUID) is never selected — these three columns are public-safe.
 */
export interface AuthorProjectionColumns {
  author_handle: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
}

/**
 * Builds the display-only author leaf from projected columns (spec 0006 Q3).
 * Null when anonymous, revoked, profile-missing, or the handle is absent.
 */
export function toPublicAuthor(row: Partial<AuthorProjectionColumns>): PublicAuthor | null {
  if (!row.author_handle || !row.author_display_name) return null;
  return {
    handle: row.author_handle,
    display_name: row.author_display_name,
    avatar_url: row.author_avatar_url ?? null,
  };
}

/**
 * Write-side public identity state DTO for a user's profile.
 */
export interface ProfileIdentityDto {
  showPublicIdentity: boolean;
  publicHandle: string | null;
  identityConsentedAt: string | null;
  publicHandleChangedAt: string | null;
}
