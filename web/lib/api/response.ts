import "server-only";

import { NextResponse } from "next/server";

import { defaultErrorStatus, type ErrorCode } from "@shared/errors";
import { getRequestId } from "@shared/request-id";

interface ApiErrorBody {
  error: ErrorCode;
  message?: string;
  details?: Record<string, unknown>;
  request_id?: string;
  [key: string]: unknown;
}

/**
 * Extra fields merged into the error body beside `error`/`message`.
 * Envelope keys win: `error`, `message`, `details`, and `request_id` in
 * `extra` are ignored.
 *
 * `extra` is the legacy top-level extras channel (`cafe_id`,
 * `existing_checkin_id`, `n`): every `extra` key is also mirrored into
 * `details` for one release, then `extra` is dropped (spec 0011 D2).
 */
interface ApiErrorExtra {
  extra?: Record<string, unknown>;
  /** Machine-readable extras — `fields[]` for 422, ids for 409. */
  details?: Record<string, unknown>;
  /** Request in scope: its `x-request-id` is echoed as `request_id`. */
  request?: { headers: Headers };
  /** Already-resolved request id (e.g. from `apiRoute`); wins over `request`. */
  requestId?: string;
}

/** Options for the message form: HTTP status plus extra body fields. */
interface ApiErrorOptions extends ApiErrorExtra {
  /** Defaults to the registry's canonical status for `code`. */
  status?: number;
}

/**
 * Standardized API error response helper (Fixes #235, spec 0011 D2/D3).
 * Supports:
 * - apiError("unauthorized", 401)
 * - apiError("invalid_request", "id must be a UUID", { status: 400 })
 * - apiError("cafe_exists", 409, { extra: { cafe_id: "..." } })
 * - apiError("cafe_exists", "Cafe already exists", { status: 409, extra: { cafe_id: "..." } })
 * - apiError("invalid_photos", "photo ids not consumable", { details: { fields: [...] }, request })
 *
 * `code` must be registered in `web/shared/errors.ts` — unregistered codes
 * fail typecheck. Status defaults to the registry's canonical status; pass
 * one explicitly only for passthrough codes. Status and extra fields are
 * named options, never positional: a bare object third argument
 * (`apiError(code, msg, { cafe_id })`) is a compile error, not silently
 * dropped.
 *
 * `request_id` is emitted on every 5xx (generated when no request is in
 * scope) and on any status when `request` is passed.
 */
export function apiError(
  code: ErrorCode,
  status?: number,
  options?: ApiErrorExtra,
): NextResponse<ApiErrorBody>;
export function apiError(
  code: ErrorCode,
  message: string,
  options?: ApiErrorOptions,
): NextResponse<ApiErrorBody>;
export function apiError(
  code: ErrorCode,
  messageOrStatus?: string | number,
  options?: ApiErrorOptions,
): NextResponse<ApiErrorBody> {
  let message: string | undefined;
  let statusCode: number | undefined;

  if (typeof messageOrStatus === "number") {
    statusCode = messageOrStatus;
  } else if (typeof messageOrStatus === "string") {
    message = messageOrStatus;
    statusCode = options?.status;
  }
  statusCode ??= defaultErrorStatus(code);

  const details =
    options?.extra || options?.details
      ? { ...options?.extra, ...options?.details }
      : undefined;

  const body: ApiErrorBody = {
    ...(options?.extra ?? {}),
    error: code,
    ...(message !== undefined ? { message } : {}),
    ...(details !== undefined ? { details } : {}),
    ...(statusCode >= 500 || options?.request !== undefined || options?.requestId !== undefined
      ? { request_id: options?.requestId ?? getRequestId(options?.request) }
      : {}),
  };

  return NextResponse.json(body, { status: statusCode });
}

/**
 * Parse an optional positive integer parameter from search query strings.
 * Returns the clamped integer, or null if the string was present but not a valid positive integer.
 */
export function parseQueryPositiveInt(
  raw: string | null,
  defaultVal: number,
  maxVal: number,
): number | null {
  if (raw === null) return defaultVal;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0 || !Number.isInteger(Number(raw))) {
    return null;
  }
  return Math.min(parsed, maxVal);
}

/**
 * Parse an optional finite numeric query parameter.
 * Absent, blank, and non-numeric input all yield `undefined` so the caller
 * applies its own default.
 *
 * Intentionally paired with `parseQueryNumberOrNaN`, not replaceable by it:
 * `undefined` and `NaN` are different sentinels for the callers below.
 */
export function parseQueryNumber(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Parse a numeric query parameter that callers guard with `Number.isNaN`.
 * Absent, blank, and non-numeric input all yield `NaN`, so `Infinity`-style
 * input stays distinguishable from "absent" (`parseQueryNumber` would fold it
 * into `undefined` and change which validation branch fires).
 */
export function parseQueryNumberOrNaN(raw: string | null): number {
  return raw === null || raw.trim() === "" ? NaN : Number(raw);
}

/**
 * Parse an optional 0-100 score filter (work-dimension thresholds).
 * Non-numeric and out-of-range input are dropped (`undefined`), never clamped.
 */
export function parseQueryScore(raw: string | null): number | undefined {
  const num = parseQueryNumber(raw);
  if (num === undefined || num < 0 || num > 100) return undefined;
  return num;
}

/**
 * Parse an optional boolean query flag.
 * Only `"true"` and `"1"` are true; any other present value is false, and only
 * absence yields `undefined`.
 */
export function parseQueryBoolean(raw: string | null): boolean | undefined {
  if (raw === null) return undefined;
  return raw === "true" || raw === "1";
}
