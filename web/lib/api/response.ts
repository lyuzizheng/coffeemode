import "server-only";

import { NextResponse } from "next/server";

interface ApiErrorBody {
  error: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * Standardized API error response helper (Fixes #235).
 * Supports:
 * - apiError("unauthorized", 401)
 * - apiError("invalid_request", "id must be a UUID", 400)
 * - apiError("cafe_exists", 409, { cafe_id: "..." })
 * - apiError("cafe_exists", "Cafe already exists", 409, { cafe_id: "..." })
 */
export function apiError(
  error: string,
  messageOrStatus?: string | number,
  statusOrExtra?: number | Record<string, unknown>,
  extra?: Record<string, unknown>,
): NextResponse<ApiErrorBody> {
  let message: string | undefined;
  let statusCode = 400;
  let additionalFields: Record<string, unknown> | undefined;

  if (typeof messageOrStatus === "number") {
    statusCode = messageOrStatus;
    if (typeof statusOrExtra === "object" && statusOrExtra !== null) {
      additionalFields = statusOrExtra;
    }
  } else if (typeof messageOrStatus === "string") {
    message = messageOrStatus;
    if (typeof statusOrExtra === "number") {
      statusCode = statusOrExtra;
    }
    additionalFields = extra;
  } else if (typeof statusOrExtra === "number") {
    statusCode = statusOrExtra;
    additionalFields = extra;
  }

  const body: ApiErrorBody = {
    error,
    ...(message !== undefined ? { message } : {}),
    ...(additionalFields ?? {}),
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
