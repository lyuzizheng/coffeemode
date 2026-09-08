# 0006. Opt-In Public Author Identity

## Goal

Provide an explicit, user-consented public author identity attribution for cafe creators and check-in authors in CoffeeMode V2, evolving from the MVP anonymous baseline ("A nomad") without leaking internal user UUIDs or breaking existing cache and query contracts.

## Stable decisions

This specification records all 13 owner-confirmed design decisions and 4 binding architectural corrections established during the #139 design grill.

### 13 Locked decisions

1. **Q1: Consent granularity**: One global profile-level switch (`profiles.show_public_identity`) governs both cafe-creator and check-in author attribution. No per-content flags in V2.
2. **Q2: Public handle**: On first opt-in, the server generates a collision-safe handle `slug(display_name)-xxxx` (4-character random suffix); the handle serves as the stable public key, never the internal UUID. Users may edit their handle subject to validation rules.
3. **Q3: Public DTO shape**: Uniform `author: PublicAuthor | null` field on `PublicCheckIn` and `PublicCafeDetail`/`PublicCafeShell`. `PublicAuthor` is defined as `{ handle: string; display_name: string; avatar_url: string | null }`. When `author` is `null`, clients render the localized default ("A nomad").
4. **Q4: Storage & schema migration**: Consent state lives on the `profiles` table as new columns: `show_public_identity`, `public_handle`, `identity_consented_at`, and `public_handle_changed_at`. No separate consent table.
5. **Q5: Revocation semantics**: Immediate global retroactive anonymization via read-time SQL `CASE WHEN p.show_public_identity THEN ... ELSE NULL END`. Opting out restores anonymous attribution on all public reads without deleting or modifying authored cafes or check-ins.
6. **Q6: Cache invalidation & accepted risk**: Accepted risk: Cloudflare CDN (`s-maxage 600`) and client SWR may serve stale identity for up to ~10 minutes after a toggle. No targeted cache purge is performed in V2.
7. **Q7: Decoupling check-in vs cafe creator**: A single global switch controls both dimensions. Ratified toggle copy (positive wording, owner-ratified in the #139 post-merge review):
   - zh: `在我创建的咖啡馆和打卡中公开显示我的名字`
   - en: `Show my name on cafes I create or check-ins I post`
   - Default state: unchecked (opted-out / anonymous). Label and switch state always agree: checked publishes the author's name/avatar, unchecked keeps the author anonymous.
8. **Q8: Internal UUID desensitization**: Projections join `profiles` internally by UUID but `SELECT` only safe public fields (`public_handle`, `display_name`, `avatar_url`). Internal database UUIDs (`cafes.created_by`, `checkins.user_id`, `StoredImage.by`) never leak into public API responses.
9. **Q9: API versioning & pagination contract**: `author` is a leaf display field on check-in and cafe DTOs. Mode-bound feed cursors (`newest`/`helpful`) and pagination contracts remain strictly unchanged.
10. **Q10: Gallery / image attribution**: Cafe and check-in galleries remain anonymous JSONB (`StoredImage.by` is never exposed in public responses). Image attribution follows the containing check-in or cafe's `PublicAuthor`.
11. **Q11: Abuse, rate limiting & validation**:
    - Handle regex: `^[a-z0-9][a-z0-9_-]{2,29}$` (length 3 to 30 characters).
    - Uniqueness: unique across all profiles including revoked/opted-out users.
    - Cooldown: maximum one user-chosen handle change per 7 days (tracked via `public_handle_changed_at`). First user edit after auto-generation is permitted immediately.
    - Display name reuse: bounded by `appConfig.profile.displayNameMaxChars` (24).
    - Rate limit: dedicated `identity-write` bucket (10 requests/minute, burst window) in `web/config/rate-limits.yaml`.
12. **Q12: i18n & anonymous fallback copy**: Client conditionally renders `author ? t("by_author", { name: author.display_name }) : t("a_nomad")`. Anonymous fallback preserves locale independence at the edge.
13. **Q13: Consent audit & GDPR**: Record `identity_consented_at timestamptz` on opt-in; clear to `NULL` on opt-out. No append-only consent ledger table.

### Architect corrections (binding)

1. **Migration numbering**: Migration is `web/db/migrations/0018_public_identity.sql` (0016 seed service account and 0017 cafe visibility are already allocated).
2. **Service account edge case (P1)**: When `cafes.created_by` is null or belongs to the community service account (`00000000-0000-4000-a000-000000000001`, "CoffeeMode"), the author projection must always evaluate to `author: null` to preserve maintainer branding and prevent impersonation.
3. **Dedicated endpoint**: Dedicated `PATCH /api/profile/identity` route rather than overloading cosmetic profile patch (`PATCH /api/profile`).
4. **Anti-squatting & cooldown**: Partial unique index `idx_profiles_public_handle` is defined `where public_handle is not null` (NOT conditional on `show_public_identity`) so handles remain reserved upon revocation. `public_handle_changed_at` timestamp column tracks user-initiated edits to enforce the 7-day cooldown.

## Data/API/UI behavior when relevant

### Database schema

Migration `web/db/migrations/0018_public_identity.sql` adds the following columns to `profiles`:
- `show_public_identity bool not null default false`
- `public_handle text`
- `identity_consented_at timestamptz`
- `public_handle_changed_at timestamptz`
- Unique index: `idx_profiles_public_handle on profiles (public_handle) where public_handle is not null`

### Types

- `PublicAuthor` in `web/types/identity.ts`:
  ```ts
  export interface PublicAuthor {
    handle: string;
    display_name: string;
    avatar_url: string | null;
  }
  ```

### API endpoints

- `PATCH /api/profile/identity`:
  - Authentication: authenticated user required (`getCurrentUser()`), same-origin required (`requireSameOrigin()`).
  - Rate limit: `identity-write` bucket (10/min).
  - Request body: `{ showPublicIdentity: boolean, publicHandle?: string }`.
  - Response body: single-convention camelCase — `{ ok: true, showPublicIdentity, publicHandle, identityConsentedAt, publicHandleChangedAt }`; no snake_case duplicates.
  - Opt-in: generates handle `slug(display_name)-xxxx` if none exists, sets `show_public_identity = true`, stamps `identity_consented_at = now()`.
  - Handle edit: validates regex `^[a-z0-9][a-z0-9_-]{2,29}$`, checks 7-day cooldown against `public_handle_changed_at`, checks uniqueness across all profiles.
  - Opt-out: sets `show_public_identity = false`, clears `identity_consented_at = null`, retains `public_handle` in reserved state. A `publicHandle` sent in the same request is still validated and applied — handle management is independent of the consent flag and follows the same edit rules.
  - Error codes:
    - `invalid_handle` (400): Handle does not match regex or format requirements.
    - `handle_taken` (409): Handle is already claimed by another user.
    - `handle_change_too_soon` (400): Handle changed less than 7 days ago.
    - `profile_not_found` (404): Profile does not exist.

## Edge cases

1. **Non-ASCII / Emoji display names**: Display names consisting of Chinese, emoji, or non-alphanumeric characters collapse to the safe fallback base `"nomad"` (e.g., `nomad-4a1f`).
2. **Auto-generation collisions**: Suffix generation automatically retries on collision against `idx_profiles_public_handle` up to 10 times.
3. **First handle customization**: When a handle is server-generated on opt-in, `public_handle_changed_at` remains `null`, permitting the user to immediately edit and personalize their handle without waiting 7 days.
4. **Handle reservation on opt-out**: Revoked profiles retain their `public_handle` with `show_public_identity = false`. Another user cannot claim this handle, preventing handle squatting during temporary opt-out windows.
5. **Community service account**: Author projections for the system account always return `author: null`.

## Acceptance criteria

1. **Default state unchanged**: Existing and newly created profile rows default to `show_public_identity = false`, remaining anonymous everywhere.
2. **Opt-in lifecycle**: Opting in generates a collision-safe unique handle when none exists and stamps `identity_consented_at`.
3. **Opt-out lifecycle**: Opting out sets `show_public_identity = false` and clears `identity_consented_at` without deleting authored cafes or check-ins, while keeping `public_handle` reserved.
4. **Handle validation**: Custom handles must strictly match `^[a-z0-9][a-z0-9_-]{2,29}$`. Invalid handles return 400 `invalid_handle`.
5. **Handle uniqueness**: Claiming an existing handle returns 409 `handle_taken`.
6. **7-Day cooldown**: Changing a user-chosen handle within 7 days returns 400 `handle_change_too_soon`.
7. **Rate limiting**: Exceeding 10 requests per minute on `PATCH /api/profile/identity` trips `identity-write` and returns 429.
8. **Test verification**: Unit tests verify handle validation and generation. Integration tests against real Postgres verify migration 0018 and the full consent toggle lifecycle.
