"use client";

/**
 * Profile content-area orchestration: which tab is active, the two paginated
 * queries behind the tabs, and the zero-data starter card that replaces them
 * while the account is empty (DG39). Extracted from `profile-view.tsx` so the
 * view stays under the 80-line budget.
 */
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { TabType } from "./profile-tabs";
import { fetchUserCheckIns } from "./profile-tab-checkins";
import { fetchUserCafes } from "./profile-tab-cafes";
import {
  dismissProfileGuide,
  hasDismissedProfileGuide,
} from "@/lib/profile-guide-store";

export function useProfileContent(isAuthenticated: boolean, mounted: boolean) {
  const [activeTab, setActiveTab] = useState<TabType>("checkins");
  // The starter card replaces the tabs only while the account is truly
  // empty AND the user hasn't dismissed it — either condition flips it off
  // forever (DG39).
  const [guideDismissed, setGuideDismissed] = useState(
    () => hasDismissedProfileGuide(),
  );

  // The map tab is the only consumer of the cafes query: keep it disabled
  // until first visited so a plain profile load skips one paginated DB
  // query per visit (BRAWUKA-281 P2). Once fetched, the cache persists
  // across tab switches.
  const [mapTabVisited, setMapTabVisited] = useState(activeTab === "map");
  const handleTabChange = (tab: TabType) => {
    if (tab === "map") setMapTabVisited(true);
    setActiveTab(tab);
  };

  // Queries mounted unconditionally at view level to preserve prefetch &
  // cache across tab switches.
  const checkinsQuery = useInfiniteQuery({
    queryKey: ["profile", "checkins"],
    queryFn: ({ pageParam }) => fetchUserCheckIns(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: isAuthenticated,
  });

  const cafesQuery = useInfiniteQuery({
    queryKey: ["profile", "cafes"],
    queryFn: ({ pageParam }) => fetchUserCafes(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: isAuthenticated && mapTabVisited,
  });

  // Zero-data guide: only once the check-ins query has answered with an
  // empty first page — a loading or failed fetch never flashes the card.
  const checkinsLoaded =
    checkinsQuery.isSuccess &&
    (checkinsQuery.data?.pages[0]?.items.length ?? 0) === 0;
  const showGuide =
    isAuthenticated && mounted && checkinsLoaded && !guideDismissed;

  const dismissGuide = () => {
    dismissProfileGuide();
    setGuideDismissed(true);
  };

  return {
    activeTab,
    handleTabChange,
    checkinsQuery,
    cafesQuery,
    showGuide,
    dismissGuide,
  };
}
