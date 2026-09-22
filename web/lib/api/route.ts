import "server-only";

import { getRequestId } from "@shared/request-id";
import { ApiHttpError } from "@/lib/api/api-error";
import { mapDomainError } from "@/lib/api/domain-errors";
import { guard, type RateLimitBucketName } from "@/lib/api/guard";
import { apiError } from "@/lib/api/response";
import { logError, logWarn } from "@/lib/observability/server-log";
import { requireSameOrigin } from "@/lib/security/origin";

type AuthenticatedUser = { id: string };

/**
 * Auth requirement for a route export. `"required"` gates anonymous callers
 * with 401 before anything else runs (spec 0011 D5: auth-before-validation —
 * anonymous callers never see a 400/404 that leaks resource existence).
 * A resolver covers request-dependent auth (e.g. `source === "google"` on
 * /api/places/search); resolver routes are typed as optional-auth since the
 * handler may still see `user: null`.
 */
export type ApiRouteAuth = "required" | "optional" | ((request: Request) => boolean);

interface ApiRouteOptionsBase {
  /** Bucket name declared in `web/config/rate-limits.yaml`. */
  bucket: RateLimitBucketName;
  /**
   * Run `requireSameOrigin` before the guard. REQUIRED on every mutating
   * export (POST/PUT/PATCH/DELETE) — `check-route-guards` enforces it.
   */
  origin?: boolean;
  /** Route literal for access/error log lines, e.g. `"POST /api/checkins"`. */
  route: string;
  /** Scope the rate limit to client IP instead of user id. */
  ipOnly?: boolean;
  /** Pre-resolved user forwarded to `guard()` — `null` skips the session lookup. */
  user?: AuthenticatedUser | null;
}

export interface ApiRouteOptions<Auth extends boolean> extends ApiRouteOptionsBase {
  auth?: Auth extends true ? "required" : "optional" | ((request: Request) => boolean);
}

/**
 * Handler context: everything the wrapper resolved before the handler ran.
 * `params` is the awaited route-segment object (`{}` for static routes);
 * `requestId` is the request's correlation id — pass it to `apiError` via
 * `{ requestId }` (or `{ request }`) so the envelope echoes the same id.
 */
export interface ApiRouteContext<Auth extends boolean, Segments> {
  requestId: string;
  /** Resolved route literal — same value `guard()` reports on its lines. */
  route: string;
  user: Auth extends true ? AuthenticatedUser : AuthenticatedUser | null;
  clientId: string;
  params: Segments;
}

export type ApiRouteHandler<Auth extends boolean, Segments> = (
  request: Request,
  ctx: ApiRouteContext<Auth, Segments>,
) => Promise<Response> | Response;

type RouteExport<Segments> = (
  request: Request,
  segment?: { params: Promise<Segments> },
) => Promise<Response>;

/**
 * Route boundary wrapper (spec 0011 D5, BRAWUKA-537).
 *
 * Owns, in order: request-id resolution → `requireSameOrigin` (when
 * `origin: true`) → `guard()` (auth + rate limit) → handler → catch-all:
 * `ApiHttpError` → its envelope; registered domain errors → their mapping
 * (`domain-errors.ts`); anything else → `logError` + 500 `internal_error`
 * with `request_id`. Nothing thrown escapes the envelope — including a
 * `guard()` internal failure, which previously produced a bare Next.js 500.
 *
 * Exempt routes (spec D5): /auth/callback, og-image, serwist. /api/health is
 * NOT exempt: it runs through this wrapper on the `health` bucket (BRAWUKA-639)
 * with `user: null` + `ipOnly`, so no slow auth lookup runs.
 */
export function apiRoute<Segments = Record<string, never>>(
  options: ApiRouteOptions<true> & { auth: "required" },
  handler: ApiRouteHandler<true, Segments>,
): RouteExport<Segments>;
export function apiRoute<Segments = Record<string, never>>(
  options: ApiRouteOptions<false>,
  handler: ApiRouteHandler<false, Segments>,
): RouteExport<Segments>;
export function apiRoute<Segments>(
  options: ApiRouteOptionsBase & { auth?: ApiRouteAuth },
  handler: ApiRouteHandler<boolean, Segments>,
): RouteExport<Segments> {
  const { bucket, auth, origin = false, route, ipOnly, user } = options;

  return async (request, segment) => {
    const requestId = getRequestId(request);
    try {
      const originError = checkOrigin(request, origin, route, requestId);
      if (originError) return originError;

      const requireAuth =
        typeof auth === "function" ? auth(request) : auth === "required";
      const gate = await guard(request, {
        bucket,
        requireAuth,
        route,
        ...(ipOnly !== undefined ? { ipOnly } : {}),
        ...(user !== undefined ? { user } : {}),
        requestId,
      });
      if (!gate.ok) return gate.response;

      const params = (segment ? await segment.params : {}) as Segments;
      return await handler(request, {
        requestId,
        route: gate.route,
        user: gate.user,
        clientId: gate.clientId,
        params,
      });
    } catch (err) {
      return errorResponse(err, route, requestId);
    }
  };
}

/** Same-origin gate for mutations; a rejection is a security-relevant 4xx (D7 warn line). */
function checkOrigin(
  request: Request,
  origin: boolean,
  route: string,
  requestId: string,
): Response | null {
  if (!origin) return null;
  const originError = requireSameOrigin(request, requestId);
  if (!originError) return null;
  logWarn({
    route,
    requestId,
    error: "forbidden_origin",
    status: 403,
    code: "forbidden_origin",
  });
  return originError;
}

/**
 * Catch-all mapping: `ApiHttpError` → its envelope; registered domain errors
 * → their mapping; anything else → `logError` + 500 `internal_error`.
 */
function errorResponse(err: unknown, route: string, requestId: string): Response {
  if (err instanceof ApiHttpError) {
    return apiError(err.code, err.message, {
      status: err.status,
      ...(err.details !== undefined ? { details: err.details } : {}),
      requestId,
    });
  }
  const mapped = mapDomainError(err);
  if (mapped) {
    return apiError(mapped.code, mapped.message, {
      ...(mapped.status !== undefined ? { status: mapped.status } : {}),
      ...(mapped.extra !== undefined ? { extra: mapped.extra } : {}),
      requestId,
    });
  }
  logError({ route, requestId, error: err, status: 500, code: "internal_error" });
  return apiError("internal_error", 500, { requestId });
}
