import "server-only";

import { appConfig } from "@/lib/config";
import { LAUNCH_CITIES } from "@/lib/cities";
import type { ProfilePatchResult } from "./types";

/**
 * Validate and sanitize a profile PATCH request body (DG107).
 */
export function parseProfilePatch(body: unknown): ProfilePatchResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_body", status: 400 };
  }

  const payload = body as { displayName?: unknown; currentCity?: unknown };
  const patch: { displayName?: string; currentCity?: string } = {};

  if (payload.displayName !== undefined) {
    if (typeof payload.displayName !== "string") {
      return { ok: false, error: "invalid_display_name", status: 400 };
    }
    const trimmed = payload.displayName.trim();
    if (trimmed.length === 0 || trimmed.length > appConfig.profile.displayNameMaxChars) {
      return { ok: false, error: "display_name_length", status: 400 };
    }
    patch.displayName = trimmed;
  }

  if (payload.currentCity !== undefined) {
    if (typeof payload.currentCity !== "string") {
      return { ok: false, error: "invalid_current_city", status: 400 };
    }
    const trimmedCity = payload.currentCity.trim().toLowerCase();
    if (!LAUNCH_CITIES.some((c) => c.id.toLowerCase() === trimmedCity)) {
      return { ok: false, error: "invalid_current_city", status: 400 };
    }
    patch.currentCity = trimmedCity;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "empty_patch", status: 400 };
  }

  return { ok: true, patch };
}
