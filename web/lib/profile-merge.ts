import type { Coordinates } from "@/lib/cities";

/**
 * Best-effort profile merge (DG122 storage rules): localStorage already
 * holds the anonymous state, so a failed PATCH just retries on the next
 * authenticated visit. Shared by onboarding commits and the search city
 * scope chip — both write `profiles.current_city` for signed-in users.
 */
export async function persistProfile(patch: {
  onboarded?: boolean;
  currentCity?: string;
  lastLocation?: Coordinates;
}): Promise<void> {
  try {
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    // Offline or unauthenticated race — local state is the fallback.
  }
}
