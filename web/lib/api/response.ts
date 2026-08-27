import "server-only";

import { NextResponse } from "next/server";

export interface ApiErrorBody {
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
