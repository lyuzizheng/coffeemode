"use client";

import { useId, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ProfileHeader } from "./profile-header";
import { ProfileGate } from "./profile-gate";
import { ProfileHero } from "./profile-hero";
import { ProfileStats } from "./profile-stats";
import { ProfileTabs, type TabType } from "./profile-tabs";
import { ProfileTabCheckins, fetchUserCheckIns } from "./profile-tab-checkins";
import { ProfileTabCafes, fetchUserCafes } from "./profile-tab-cafes";
import { ProfileTabFavorites } from "./profile-tab-favorites";
import { ProfileTabHistory } from "./profile-tab-history";
import { RankingPreferenceToggle } from "@/components/search/ranking-preference-toggle";
import { ProfilePreferences } from "./profile-preferences";
import type { UserProfileDto, UserProfileStatsDto } from "@/lib/db/profile";

interface ProfileViewProps {
  initialProfile: UserProfileDto | null;
  initialStats: UserProfileStatsDto | null;
  isAuthenticated: boolean;
}

export function ProfileView({
  initialProfile,
  initialStats,
  isAuthenticated,
}: ProfileViewProps) {
  const [profile, setProfile] = useState<UserProfileDto | null>(initialProfile);
  const [stats] = useState<UserProfileStatsDto | null>(initialStats);
  const [activeTab, setActiveTab] = useState<TabType>("checkins");
  const baseId = useId();

  // The map tab is the only consumer of the cafes query: keep it disabled
  // until first visited so a plain profile load skips one paginated DB
  // query per visit (BRAWUKA-281 P2). The comment above stays true in the
  // other direction — once fetched, the cache persists across tab switches.
  const [mapTabVisited, setMapTabVisited] = useState(activeTab === "map");
  const handleTabChange = (tab: TabType) => {
    if (tab === "map") setMapTabVisited(true);
    setActiveTab(tab);
  };
  // Queries mounted unconditionally at view level to preserve prefetch & cache across tab switches
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

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center">
      <ProfileHeader isAuthenticated={isAuthenticated} />

      <main className="w-full max-w-[640px] px-4 md:px-6 py-4 flex-1 flex flex-col">
        {!isAuthenticated ? (
          <ProfileGate />
        ) : (
          <>
            <ProfileHero profile={profile} onProfileChange={setProfile} />
            <ProfileStats stats={stats} />
            <ProfileTabs activeTab={activeTab} onTabChange={handleTabChange} baseId={baseId} />

            <div className="flex-1 flex flex-col py-2">
              {activeTab === "checkins" && (
                <ProfileTabCheckins baseId={baseId} query={checkinsQuery} isAuthenticated={isAuthenticated} />
              )}
              {activeTab === "map" && (
                <ProfileTabCafes baseId={baseId} query={cafesQuery} />
              )}
              {activeTab === "favorites" && (
                <ProfileTabFavorites baseId={baseId} />
              )}
              {activeTab === "history" && (
                <ProfileTabHistory baseId={baseId} />
              )}
            </div>
            <ProfilePreferences profile={profile} onProfileChange={setProfile} />
          </>
        )}
        {/* DG136: ranking preference lives in localStorage, so it stays
            reachable for anonymous sessions — as a quiet page footer below
            the gate, never inside the sign-in flow (profile-page-v2 §5). */}
        {!isAuthenticated && (
          <footer className="mt-auto border-t border-separator pt-3 pb-1">
            <RankingPreferenceToggle variant="compact" />
          </footer>
        )}
      </main>
    </div>
  );
}
