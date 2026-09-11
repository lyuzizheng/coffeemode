import "server-only";

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets, rateLimits } from "@/lib/config";
import { apiError } from "@/lib/api/response";

/**
 * Declared rate limit buckets from `web/config/rate-limits.yaml` (DG74/DG107).
 * Checked at compile-time via `RateLimitBucketName` and at runtime in `guard()`.
 */
export const RATE_LIMIT_BUCKET_NAMES = [
  "cafes-read",
  "cafes-write",
  "images",
  "places",
  "search",
  "profile-read",
  "profile-write",
  "identity-write",
] as const;

export type RateLimitBucketName = (typeof RATE_LIMIT_BUCKET_NAMES)[number];

type AuthenticatedUser = { id: string };

interface GuardOptions<Auth extends boolean = boolean> {
  /** Bucket name declared in rate-limits.yaml */
  bucket: RateLimitBucketName;
  /** Whether the route requires an authenticated user (returns 401 when unauthenticated) */
  requireAuth?: Auth;
  /** Route descriptor used for rate-limit alerting (e.g. "GET /api/cafes") */
  route?: string;
  /** Optional pre-resolved user if already fetched upstream */
  user?: AuthenticatedUser | null;
  /** If true, scopes rate limit solely by client IP instead of user ID */
  ipOnly?: boolean;
}

type GuardOkResult<Auth extends boolean> = {
  ok: true;
  user: Auth extends true ? AuthenticatedUser : AuthenticatedUser | null;
  clientId: string;
  /** Resolved route descriptor (explicit `route` or `METHOD path` fallback). */
  route: string;
};

type GuardErrResult = {
  ok: false;
  response: NextResponse;
};

type GuardResult<Auth extends boolean = boolean> =
  | GuardOkResult<Auth>
  | GuardErrResult;

/**
 * Validate that the bucket name is declared in `web/config/rate-limits.yaml`.
 * Throws an Error if invalid.
 */
function validateBucket(bucket: string): asserts bucket is RateLimitBucketName {
  if (
    !RATE_LIMIT_BUCKET_NAMES.includes(bucket as RateLimitBucketName) ||
    !rateLimits[bucket]
  ) {
    throw new Error(
      `Invalid rate limit bucket: "${bucket}". Declared buckets in rate-limits.yaml: ${RATE_LIMIT_BUCKET_NAMES.join(
        ", ",
      )}`,
    );
  }
}

/**
 * Resolve fallback route string from Request for telemetry and alerting.
 */
function resolveRouteString(request: Request, route?: string): string {
  if (route) return route;
  try {
    return `${request.method} ${new URL(request.url).pathname}`;
  } catch {
    return `${request.method} unknown`;
  }
}

/**
 * Unified API route gatekeeper (BRAWUKA-181):
 * Combines authentication, rate-limiting, and error envelopes into a single call.
 *
 * Sequence:
 * 1. Validate bucket name (compile-time & runtime double check)
 * 2. Authenticate user if `requireAuth: true` (401 unauthorized on missing user)
 * 3. Calculate client identifier (user id when authenticated, hashed IP otherwise)
 * 4. Check multi-window rate limit against bucket (429 rate_limited on exhaustion)
 * 5. Return `{ ok: true, user, clientId }`
 */
export async function guard(
  request: Request,
  options: GuardOptions<true>,
): Promise<GuardOkResult<true> | GuardErrResult>;
export async function guard(
  request: Request,
  options: GuardOptions<false>,
): Promise<GuardOkResult<false> | GuardErrResult>;
export async function guard(
  request: Request,
  options: GuardOptions,
): Promise<GuardResult>;
export async function guard(
  request: Request,
  options: GuardOptions,
): Promise<GuardResult> {
  const { bucket, requireAuth = false, route, user: preResolvedUser, ipOnly = false } = options;

  // 1. Runtime bucket check
  validateBucket(bucket);

  // 2. Authentication check
  const user =
    preResolvedUser !== undefined ? preResolvedUser : await getCurrentUser();

  if (requireAuth && !user) {
    return {
      ok: false,
      response: apiError("unauthorized", 401),
    };
  }

  // 3. Client identifier calculation
  const clientId = getClientIdentifier(request, ipOnly ? null : user);

  // 4. Rate limit check (using normalized buckets from config)
  const resolvedRoute = resolveRouteString(request, route);
  const rate = await checkRateLimit(
    bucket,
    clientId,
    rateLimitBuckets(bucket),
    resolvedRoute,
  );

  if (!rate.allowed) {
    return {
      ok: false,
      response: rateLimitResponse(rate),
    };
  }

  return {
    ok: true,
    user,
    clientId,
    route: resolvedRoute,
  };
}

interface ReadJsonBodyOptions {
  /** If true, returns data: null when request body is empty instead of returning 400 */
  optional?: boolean;
}

type ReadJsonBodyResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

/**
 * Unified JSON body parser (BRAWUKA-181).
 * Parses request body as JSON; returns 400 invalid_request on malformed/invalid JSON.
 * Empty body with `{ optional: true }` yields `data: null` — typed, not cast.
 */
export async function readJsonBody<T = unknown>(
  request: Request,
  options: ReadJsonBodyOptions & { optional: true },
): Promise<ReadJsonBodyResult<T | null>>;
export async function readJsonBody<T = unknown>(
  request: Request,
  options?: ReadJsonBodyOptions,
): Promise<ReadJsonBodyResult<T>>;
export async function readJsonBody<T = unknown>(
  request: Request,
  options?: ReadJsonBodyOptions,
): Promise<ReadJsonBodyResult<T | null>> {
  try {
    const text = await request.text();
    if (!text || text.trim() === "") {
      if (options?.optional) {
        return { ok: true, data: null };
      }
      return {
        ok: false,
        response: apiError("invalid_request", "invalid JSON body", 400),
      };
    }
    const data = JSON.parse(text) as T;
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: apiError("invalid_request", "invalid JSON body", 400),
    };
  }
}
