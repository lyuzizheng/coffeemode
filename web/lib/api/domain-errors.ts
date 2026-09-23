import "server-only";

import type { ErrorCode } from "@shared/errors";
import {
  FeedCursorError,
  FeedCursorExpiredError,
} from "@/lib/discovery/feed";
import {
  HandleChangeTooSoonError,
  HandleTakenError,
  InvalidHandleError,
  ProfileNotFoundError,
} from "@/lib/db/identity";
import { ProfileCursorError } from "@/lib/db/profile/cursor";
import { ImageServiceError } from "@/lib/images/image-service-client";
import { PhotoIntentError } from "@/lib/images/provision-photos";
import { POIServiceError } from "@/lib/places/poi-client";
import {
  CafeExistsError,
  CafeForbiddenError,
  CafeHasOtherCheckinsError,
} from "@/lib/validation/cafe";
import {
  CafeNotFoundError,
  CheckInForbiddenError,
  CheckInNotFoundError,
  CheckInPhotoLimitError,
  DuplicateCheckInError,
  SelfLikeError,
} from "@/lib/validation/checkin";

/**
 * Domain-error → envelope registry (spec 0011 D5, BRAWUKA-537).
 *
 * `lib/db/*` and `lib/validation/*` throw typed errors that stay HTTP-free;
 * this table is the single place they gain `code`/`status`/`details` — at
 * the route boundary, inside `apiRoute`'s catch-all. A thrown error whose
 * class is not listed here falls through to `500 internal_error`.
 *
 * `status` omitted → the registry's canonical status for `code`
 * (`defaultErrorStatus`). Passthrough codes (`poi_service`,
 * `image_service_error`) MUST resolve a status from the error.
 *
 * `extra` fields land BOTH top-level (legacy, one release) and under
 * `details` — see `apiError`.
 */
export interface DomainErrorMapping {
  code: ErrorCode;
  status?: number;
  message: string;
  extra?: Record<string, unknown>;
}

type DomainErrorMapper = (error: Error) => DomainErrorMapping | null;

function entry<E extends Error>(
  type: new (...args: never[]) => E,
  map: (error: E) => Omit<DomainErrorMapping, "message"> & { message?: string },
): DomainErrorMapper {
  return (error) => {
    if (!(error instanceof type)) return null;
    const mapped = map(error);
    return { ...mapped, message: mapped.message ?? error.message };
  };
}

const DOMAIN_ERROR_MAPPERS: ReadonlyArray<DomainErrorMapper> = [
  // cafes
  entry(CafeExistsError, (err) => ({
    code: "cafe_exists",
    // BRAWUKA-467: a raced-23505 winner lookup can return 0 rows — never
    // emit `cafe_id: null`; fall back to the bare 409 the client handles.
    extra: err.existingCafeId ? { cafe_id: err.existingCafeId } : undefined,
  })),
  entry(CafeHasOtherCheckinsError, (err) => ({
    code: "cafe_has_other_checkins",
    extra: { n: err.n },
  })),
  entry(CafeForbiddenError, (err) => ({ code: "forbidden", message: err.message })),
  entry(CafeNotFoundError, () => ({ code: "not_found", message: "cafe not found" })),
  // checkins
  entry(DuplicateCheckInError, (err) => ({
    code: "duplicate_checkin",
    message: "check-in already exists for this visit",
    extra: { existing_checkin_id: err.existingCheckinId },
  })),
  entry(CheckInNotFoundError, () => ({ code: "not_found", message: "check-in not found" })),
  entry(CheckInForbiddenError, (err) => ({ code: "forbidden", message: err.message })),
  entry(SelfLikeError, () => ({
    code: "self_like_forbidden",
    message: "you cannot like your own check-in",
  })),
  entry(CheckInPhotoLimitError, (err) => ({
    code: "invalid_photos",
    message: err.message,
  })),
  // feeds & profile lists
  entry(FeedCursorExpiredError, () => ({
    code: "cursor_version_expired",
    message: "snapshot version expired; restart from page one",
  })),
  entry(FeedCursorError, () => ({
    code: "invalid_request",
    message: "cursor is invalid or was issued for another mode",
  })),
  entry(ProfileCursorError, () => ({ code: "invalid_cursor" })),
  // identity
  entry(InvalidHandleError, () => ({ code: "invalid_handle" })),
  entry(HandleTakenError, () => ({ code: "handle_taken" })),
  entry(HandleChangeTooSoonError, () => ({ code: "handle_change_too_soon" })),
  entry(ProfileNotFoundError, () => ({ code: "profile_not_found" })),
  // photos & upstream workers
  entry(PhotoIntentError, () => ({
    code: "invalid_photos",
    message: "one or more photos are invalid",
  })),
  entry(ImageServiceError, (err) => ({
    code: "image_service_error",
    status: err.status,
    message: err.message,
  })),
  entry(POIServiceError, (err) => ({
    code: "poi_service",
    status: err.status,
    message: err.message,
  })),
];

/**
 * Resolve a thrown domain error to its registered envelope mapping, or
 * `null` when the class is unknown (caller maps to `internal_error`).
 * `message` is always resolved — the error's own message when the entry
 * does not pin one.
 */
export function mapDomainError(error: unknown): DomainErrorMapping | null {
  if (!(error instanceof Error)) return null;
  for (const mapper of DOMAIN_ERROR_MAPPERS) {
    const mapped = mapper(error);
    if (mapped) return mapped;
  }
  return null;
}
