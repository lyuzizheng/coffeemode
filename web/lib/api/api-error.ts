import "server-only";

import { defaultErrorStatus, type ErrorCode } from "@shared/errors";

/**
 * HTTP-carrying domain error (spec 0011 D4, BRAWUKA-536).
 *
 * Thrown by route handlers and service code when the failure maps directly
 * to an error envelope; the route boundary (`apiRoute`, stage 2) maps it to
 * `apiError(code, message, { status, details, request })`. `lib/db/*` typed
 * errors stay HTTP-free — they gain `code`/`status` at the boundary, not by
 * extending this class.
 *
 * `status` defaults to the registry's canonical status for `code`; pass an
 * explicit status only for passthrough codes (`poi_service`,
 * `image_service_error`) that mirror an upstream worker response.
 */
export class ApiHttpError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message?: string,
    options?: { status?: number; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message ?? code, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ApiHttpError";
    this.code = code;
    this.status = options?.status ?? defaultErrorStatus(code);
    if (options?.details !== undefined) this.details = options.details;
  }
}
