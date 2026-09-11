import "server-only";

import type { UserProfileDto } from "./types";

export type ProfileIdentityRow = {
  show_public_identity: boolean;
  public_handle: string | null;
  identity_consented_at: Date | null;
  public_handle_changed_at: Date | null;
};

/**
 * Project the opt-in public-identity columns of a `profiles` row onto the DTO.
 *
 * Boundary note: this is a pure row projection for reads/writes in this
 * directory. Handle lifecycle (validation, reservation, cooldown, opt-in/out)
 * lives in `lib/db/identity.ts` — do not grow this module into a second
 * identity god module.
 */
export function mapIdentityFields(row: ProfileIdentityRow): Pick<
  UserProfileDto,
  "showPublicIdentity" | "publicHandle" | "identityConsentedAt" | "publicHandleChangedAt"
> {
  return {
    showPublicIdentity: row.show_public_identity,
    publicHandle: row.public_handle,
    identityConsentedAt: row.identity_consented_at ? new Date(row.identity_consented_at).toISOString() : null,
    publicHandleChangedAt: row.public_handle_changed_at
      ? new Date(row.public_handle_changed_at).toISOString()
      : null,
  };
}
