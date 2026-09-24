/**
 * Error-code registry — the single source of truth for the `error` machine
 * code in every non-2xx API envelope (spec 0011 D3, BRAWUKA-536).
 *
 * `apiError()` (web) and the worker `json({error})` helper take
 * `keyof typeof ERROR_CODES`, so an unregistered code fails typecheck.
 * Adding a code = one entry here + one row in the spec's registry table.
 * Renaming or deleting a deployed code is a contract break.
 *
 * Keep this file dependency-free: it is imported by the Next.js app AND by
 * both Cloudflare Workers via `web/shared/`.
 */

export interface ErrorCodeEntry {
  /**
   * Canonical HTTP status for the code. `"passthrough"` marks codes whose
   * status mirrors an upstream worker response (`poi_service`,
   * `image_service_error`) — callers must pass an explicit status.
   */
  status: number | "passthrough";
  /** Owning domain for grouping metrics and docs. */
  domain: string;
  /** One-line developer-facing description (never rendered to users). */
  summary: string;
}

export const ERROR_CODES = {
  // auth
  unauthorized: { status: 401, domain: "auth", summary: "missing/invalid session or service token" },
  forbidden: { status: 403, domain: "auth", summary: "authenticated, not owner/allowed" },
  forbidden_origin: { status: 403, domain: "auth", summary: "cross-origin mutation rejected" },
  bot_verification_failed: { status: 403, domain: "auth", summary: "Turnstile failure (collapses 4 turnstile codes)" },
  invalid_provider: { status: 400, domain: "auth", summary: "OAuth provider unknown" },
  provider_start_failed: { status: 500, domain: "auth", summary: "OAuth start failed" },
  signout_failed: { status: 500, domain: "auth", summary: "sign-out failed" },
  not_configured: { status: 503, domain: "auth", summary: "auth backend not configured" },
  // request
  invalid_request: { status: 400, domain: "request", summary: "malformed input (catch-all structural)" },
  invalid_body: { status: 400, domain: "request", summary: "body not a JSON object" },
  invalid_limit: { status: 400, domain: "request", summary: "pagination limit out of range" },
  invalid_cursor: { status: 400, domain: "request", summary: "malformed feed cursor" },
  cursor_version_expired: { status: 410, domain: "request", summary: "feed snapshot expired — restart page one" },
  rate_limited: { status: 429, domain: "request", summary: "rate limited — Retry-After header set" },
  empty_patch: { status: 400, domain: "request", summary: "PATCH with no fields" },
  // server
  internal_error: { status: 500, domain: "server", summary: "catch-all; body carries request_id" },
  upstream_error: { status: 502, domain: "server", summary: "upstream dependency failed" },
  db_unavailable: { status: 503, domain: "server", summary: "Postgres pool down" },
  // resource
  not_found: { status: 404, domain: "resource", summary: "generic missing resource" },
  // profile
  profile_not_found: { status: 404, domain: "profile", summary: "profile does not exist" },
  invalid_handle: { status: 400, domain: "profile", summary: "handle syntax" },
  handle_taken: { status: 409, domain: "profile", summary: "handle already taken" },
  handle_change_too_soon: { status: 422, domain: "profile", summary: "handle change cooldown — semantic rule" },
  invalid_display_name: { status: 422, domain: "profile", summary: "display name violates domain rules" },
  display_name_length: { status: 422, domain: "profile", summary: "display name length out of range" },
  invalid_current_city: { status: 422, domain: "profile", summary: "current city violates domain rules" },
  invalid_last_location: { status: 422, domain: "profile", summary: "last location violates domain rules" },
  invalid_onboarded: { status: 422, domain: "profile", summary: "onboarded flag violates domain rules" },
  invalid_location: { status: 400, domain: "profile", summary: "onboarding location malformed" },
  // cafe
  cafe_exists: { status: 409, domain: "cafe", summary: "cafe already exists — details.cafe_id" },
  cafe_has_other_checkins: { status: 409, domain: "cafe", summary: "cafe blocked by other checkins — details.n" },
  // checkin
  duplicate_checkin: { status: 409, domain: "checkin", summary: "check-in already exists — details.existing_checkin_id" },
  self_like_forbidden: { status: 403, domain: "checkin", summary: "cannot like own check-in" },
  invalid_photos: { status: 422, domain: "checkin", summary: "photo ids well-formed but unconsumed" },
  // places
  invalid_maps_url: { status: 400, domain: "places", summary: "URL host not allowlisted" },
  poi_service: { status: "passthrough", domain: "places", summary: "poi worker status mirrored (502/404/413/422 only — client sanitizes)" },
  // images
  image_service_error: { status: "passthrough", domain: "images", summary: "image worker status mirrored (502/404/413/422 only — client sanitizes)" },
  size_exceeded: { status: 413, domain: "images", summary: "photo bytes over the upload cap" },
  // mapkit
  mapkit_not_configured: { status: 503, domain: "mapkit", summary: "MapKit not configured" },
  mapkit_token_error: { status: 500, domain: "mapkit", summary: "MapKit token minting failed" },
  // poi-worker
  unresolvable: { status: 422, domain: "poi-worker", summary: "no upstream provider for source" },
  invalid_upstream: { status: 502, domain: "poi-worker", summary: "upstream returned unparseable data" },
} as const satisfies Record<string, ErrorCodeEntry>;

/** Machine code for the `error` field — the contract clients branch on. */
export type ErrorCode = keyof typeof ERROR_CODES;

/** Narrow an unknown value (e.g. a parsed response body field) to a registered code. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in ERROR_CODES;
}

/**
 * Canonical status for a code. `"passthrough"` codes have no canonical
 * status; callers must pass one explicitly — this fallback (502) only keeps
 * the helper total for misuse, matching upstream-failure semantics.
 */
export function defaultErrorStatus(code: ErrorCode): number {
  const status = ERROR_CODES[code].status;
  return typeof status === "number" ? status : 502;
}

/**
 * Allowed client-mirrored HTTP statuses for passthrough error codes
 * (`poi_service`, `image_service_error`). Any upstream status outside this set
 * maps to 502 (spec 0011 D3/D8, BRAWUKA-596).
 */
export const PASSTHROUGH_STATUSES = [404, 413, 422] as const;
export type PassthroughStatus = (typeof PASSTHROUGH_STATUSES)[number];

export function isPassthroughStatus(status: number): status is PassthroughStatus {
  return (PASSTHROUGH_STATUSES as readonly number[]).includes(status);
}

/**
 * Sanitize an upstream worker status into a registered passthrough status.
 * Clamps to {404, 413, 422}; maps everything else >= 400 to 502 (spec 0011, BRAWUKA-596).
 */
export function sanitizePassthroughStatus(upstreamStatus: number): PassthroughStatus | 502 {
  if (isPassthroughStatus(upstreamStatus)) {
    return upstreamStatus;
  }
  return 502;
}
