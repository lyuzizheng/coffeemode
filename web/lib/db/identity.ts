import "server-only";

import { randomBytes } from "node:crypto";
import { query } from "@/lib/db/postgres";
import { isValidUUID } from "@shared/uuid";
import type { ProfileIdentityDto } from "@/types/identity";

/**
 * Handle regex per Spec / Decision Q11:
 * - Starts with lowercase alphanumeric [a-z0-9]
 * - Followed by 2 to 29 characters from [a-z0-9_-]
 * - Total length: 3 to 30 characters
 */
export const PUBLIC_HANDLE_REGEX = /^[a-z0-9][a-z0-9_-]{2,29}$/;

/** Cooldown window for user-chosen handle edits: 7 days in ms. */
export const HANDLE_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export class InvalidHandleError extends Error {
  constructor(message = "invalid_handle") {
    super(message);
    this.name = "InvalidHandleError";
  }
}

export class HandleTakenError extends Error {
  constructor(message = "handle_taken") {
    super(message);
    this.name = "HandleTakenError";
  }
}

export class HandleChangeTooSoonError extends Error {
  constructor(message = "handle_change_too_soon") {
    super(message);
    this.name = "HandleChangeTooSoonError";
  }
}

export class ProfileNotFoundError extends Error {
  constructor(message = "profile_not_found") {
    super(message);
    this.name = "ProfileNotFoundError";
  }
}

/** Validate whether a string is a valid public handle. */
export function validatePublicHandle(handle: string): boolean {
  if (typeof handle !== "string") return false;
  return PUBLIC_HANDLE_REGEX.test(handle);
}

/**
 * Derive a clean base slug from display_name.
 * Converts to lowercase, strips non-alphanumeric chars into hyphens,
 * trims repeated/leading/trailing hyphens, and truncates to max 25 chars.
 * If empty or non-ASCII, falls back to "nomad".
 */
export function slugifyDisplayName(displayName: string): string {
  if (typeof displayName !== "string") return "nomad";

  let slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length > 25) {
    slug = slug.slice(0, 25).replace(/-+$/, "");
  }

  if (slug.length === 0 || !/^[a-z0-9]/.test(slug)) {
    return "nomad";
  }

  return slug;
}

/**
 * Check if the user is permitted to change their handle now based on 7-day cooldown.
 * Null publicHandleChangedAt means the handle was server-generated (or never set),
 * which permits the first user edit immediately.
 */
export function canChangeHandle(
  publicHandleChangedAt: Date | string | null,
  now: Date = new Date(),
): boolean {
  if (!publicHandleChangedAt) return true;
  const changedAt = new Date(publicHandleChangedAt).getTime();
  if (Number.isNaN(changedAt)) return true;
  return now.getTime() - changedAt >= HANDLE_CHANGE_COOLDOWN_MS;
}

/**
 * Generate a collision-safe handle `slug(display_name)-xxxx` (Q2).
 * Retries with fresh random suffix on collision.
 */
export async function generatePublicHandle(
  displayName: string,
  isHandleTaken?: (handle: string) => Promise<boolean>,
): Promise<string> {
  const base = slugifyDisplayName(displayName);
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const suffix = randomBytes(2).toString("hex");
    const candidate = `${base}-${suffix}`;
    if (!isHandleTaken) {
      return candidate;
    }
    const taken = await isHandleTaken(candidate);
    if (!taken) {
      return candidate;
    }
  }

  throw new Error("Failed to generate unique public handle after maximum attempts");
}

interface ProfileRow extends Record<string, unknown> {
  id: string;
  display_name: string;
  show_public_identity: boolean;
  public_handle: string | null;
  identity_consented_at: Date | string | null;
  public_handle_changed_at: Date | string | null;
}

/** Get public identity state for a user. */
export async function getProfileIdentity(userId: string): Promise<ProfileIdentityDto | null> {
  if (!isValidUUID(userId)) return null;

  const result = await query<ProfileRow>(
    `
    select id, display_name, show_public_identity, public_handle, identity_consented_at, public_handle_changed_at
    from profiles
    where id = $1
    `,
    [userId],
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];

  return {
    showPublicIdentity: row.show_public_identity,
    publicHandle: row.public_handle,
    identityConsentedAt: row.identity_consented_at ? new Date(row.identity_consented_at).toISOString() : null,
    publicHandleChangedAt: row.public_handle_changed_at ? new Date(row.public_handle_changed_at).toISOString() : null,
  };
}

/**
 * Update public identity consent and handle for a profile.
 * Implements Stage 1 write-side semantics:
 * - Opt-in: generate handle if none exists (retry on unique-violation); set flag + identity_consented_at = now().
 * - Handle edit: regex + uniqueness + 7-day window from public_handle_changed_at.
 * - Opt-out: flag false, identity_consented_at = null; handle retained (reserved).
 */
export async function updateProfileIdentity(
  userId: string,
  patch: { showPublicIdentity: boolean; publicHandle?: string },
): Promise<ProfileIdentityDto> {
  if (!isValidUUID(userId)) {
    throw new ProfileNotFoundError();
  }

  const existingRes = await query<ProfileRow>(
    `
    select id, display_name, show_public_identity, public_handle, identity_consented_at, public_handle_changed_at
    from profiles
    where id = $1
    `,
    [userId],
  );

  if (existingRes.rows.length === 0) {
    throw new ProfileNotFoundError();
  }

  const current = existingRes.rows[0];

  // Handle edit validation if publicHandle is specified
  let userProvidedHandle: string | undefined;
  if (patch.publicHandle !== undefined) {
    const trimmed = patch.publicHandle.trim().toLowerCase();
    if (!validatePublicHandle(trimmed)) {
      throw new InvalidHandleError();
    }
    userProvidedHandle = trimmed;

    // Check if handle is actually changing
    if (trimmed !== current.public_handle) {
      if (!canChangeHandle(current.public_handle_changed_at)) {
        throw new HandleChangeTooSoonError();
      }

      // Check if handle is taken (even by revoked users)
      const takenRes = await query<{ id: string }>(
        `select id from profiles where public_handle = $1 and id != $2 limit 1`,
        [trimmed, userId],
      );
      if (takenRes.rows.length > 0) {
        throw new HandleTakenError();
      }
    }
  }

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let newPublicHandle: string | null = current.public_handle;
    let newPublicHandleChangedAt: Date | null = current.public_handle_changed_at
      ? new Date(current.public_handle_changed_at)
      : null;
    let newIdentityConsentedAt: Date | null = current.identity_consented_at
      ? new Date(current.identity_consented_at)
      : null;

    if (patch.showPublicIdentity) {
      if (userProvidedHandle !== undefined) {
        if (userProvidedHandle !== current.public_handle) {
          newPublicHandle = userProvidedHandle;
          newPublicHandleChangedAt = new Date();
        }
      } else if (newPublicHandle === null) {
        // First opt-in without custom handle: auto-generate
        newPublicHandle = await generatePublicHandle(current.display_name, async (candidate) => {
          const res = await query<{ id: string }>(
            `select id from profiles where public_handle = $1 limit 1`,
            [candidate],
          );
          return res.rows.length > 0;
        });
        // Auto-generation leaves changed_at null so user can edit their handle immediately
        newPublicHandleChangedAt = null;
      }

      if (!newIdentityConsentedAt) {
        newIdentityConsentedAt = new Date();
      }
    } else {
      // Opt-out: keep handle reserved, clear consent timestamp
      if (userProvidedHandle !== undefined && userProvidedHandle !== current.public_handle) {
        newPublicHandle = userProvidedHandle;
        newPublicHandleChangedAt = new Date();
      }
      newIdentityConsentedAt = null;
    }

    try {
      const updateRes = await query<ProfileRow>(
        `
        update profiles
        set show_public_identity = $2,
            public_handle = $3,
            identity_consented_at = $4,
            public_handle_changed_at = $5
        where id = $1
        returning id, display_name, show_public_identity, public_handle, identity_consented_at, public_handle_changed_at
        `,
        [
          userId,
          patch.showPublicIdentity,
          newPublicHandle,
          newIdentityConsentedAt,
          newPublicHandleChangedAt,
        ],
      );

      const row = updateRes.rows[0];
      return {
        showPublicIdentity: row.show_public_identity,
        publicHandle: row.public_handle,
        identityConsentedAt: row.identity_consented_at
          ? new Date(row.identity_consented_at).toISOString()
          : null,
        publicHandleChangedAt: row.public_handle_changed_at
          ? new Date(row.public_handle_changed_at).toISOString()
          : null,
      };
    } catch (err: unknown) {
      const isUniqueViolation =
        typeof err === "object" && err !== null && "code" in err && err.code === "23505";

      if (isUniqueViolation) {
        if (userProvidedHandle !== undefined) {
          throw new HandleTakenError();
        }
        // Auto-generated handle collision on concurrent write: retry loop
        continue;
      }
      throw err;
    }
  }

  throw new Error("Failed to update profile identity after collision retries");
}
