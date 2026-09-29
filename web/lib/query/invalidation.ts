import type { QueryClient } from "@tanstack/react-query";

/**
 * Shared check-in invalidation set (BRAWUKA-732). A check-in write touches the
 * cafe aggregate, its check-in feeds, the "last check-in" prompt state, the
 * viewer profile and the persisted discovery list — every caller (submit,
 * edit, check-in delete, cafe delete) must refresh the same five keys, so the
 * operation lives here instead of inside the check-in transport module.
 */
export function invalidateCheckinQueries(queryClient: QueryClient, cafeId: string) {
  queryClient.invalidateQueries({ queryKey: ["cafe", cafeId] });
  queryClient.invalidateQueries({ queryKey: ["cafe-checkins", cafeId] });
  queryClient.invalidateQueries({ queryKey: ["last-checkin", cafeId] });
  queryClient.invalidateQueries({ queryKey: ["profile"] });
  // The discovery list renders work_stats.composite_score on every card and
  // "cafes-list" is IndexedDB-persisted — without this the new check-in's
  // score stays stale across tab reopens (keys.ts: mutations invalidate
  // every affected key explicitly).
  queryClient.invalidateQueries({ queryKey: ["cafes-list"] });
}
