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
 * Write-side public identity state DTO for a user's profile.
 */
export interface ProfileIdentityDto {
  showPublicIdentity: boolean;
  publicHandle: string | null;
  identityConsentedAt: string | null;
  publicHandleChangedAt: string | null;
}
