import "server-only";

import { appConfig } from "@/lib/config";
import type { ErrorCode } from "@shared/errors";

/**
 * Profile PATCH payload validation (spec 0009 §1: request validation lives in
 * `lib/validation/**`, never in the persistence layer; BRAWUKA-199 review).
 *
 * `currentCity` accepts any bounded non-empty string, not just launch cities:
 * DG121 runtime-created cities (geolocation outside coverage) must persist.
 * `onboarded`/`lastLocation` carry the first-visit onboarding merge (DG122).
 */

export interface ProfilePatch {
  displayName?: string;
  currentCity?: string;
  onboarded?: boolean;
  lastLocation?: { lat: number; lng: number };
}

type ProfilePatchResult =
  | { ok: true; patch: ProfilePatch }
  | { ok: false; error: ErrorCode; status: number };

type FieldResult<T> = { ok: true; value: T } | { ok: false; error: ErrorCode };

function parseDisplayName(value: unknown): FieldResult<string> {
  if (typeof value !== "string") return { ok: false, error: "invalid_display_name" };
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > appConfig.profile.displayNameMaxChars) {
    return { ok: false, error: "display_name_length" };
  }
  return { ok: true, value: trimmed };
}

function parseCurrentCity(value: unknown): FieldResult<string> {
  if (typeof value !== "string") return { ok: false, error: "invalid_current_city" };
  const trimmed = value.trim().toLowerCase();
  if (
    trimmed.length === 0 ||
    trimmed.length > appConfig.validation.profileCityMaxChars
  ) {
    return { ok: false, error: "invalid_current_city" };
  }
  return { ok: true, value: trimmed };
}

function parseOnboarded(value: unknown): FieldResult<boolean> {
  if (typeof value !== "boolean") return { ok: false, error: "invalid_onboarded" };
  return { ok: true, value };
}

function parseLastLocation(
  value: unknown,
): FieldResult<{ lat: number; lng: number }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "invalid_last_location" };
  }
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return { ok: false, error: "invalid_last_location" };
  }
  return { ok: true, value: { lat, lng } };
}

export function parseProfilePatch(body: unknown): ProfilePatchResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_body", status: 400 };
  }

  const payload = body as Record<keyof ProfilePatch, unknown>;
  const patch: ProfilePatch = {};

  const fields = [
    ["displayName", parseDisplayName],
    ["currentCity", parseCurrentCity],
    ["onboarded", parseOnboarded],
    ["lastLocation", parseLastLocation],
  ] as const;

  for (const [key, parse] of fields) {
    const raw = payload[key];
    if (raw === undefined) continue;
    const result = parse(raw);
    if (!result.ok) return { ok: false, error: result.error, status: 400 };
    Object.assign(patch, { [key]: result.value });
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "empty_patch", status: 400 };
  }

  return { ok: true, patch };
}
