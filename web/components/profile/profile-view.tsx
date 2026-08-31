"use client";

import { useId, useState } from "react";
import { ProfileHeader } from "./profile-header";
import { ProfileGate } from "./profile-gate";
import { ProfileHero } from "./profile-hero";
import { ProfileStats } from "./profile-stats";
import { ProfileTabs, type TabType } from "./profile-tabs";
import { ProfileTabCheckins } from "./profile-tab-checkins";
import { ProfileTabCafes } from "./profile-tab-cafes";
import { ProfileTabFavorites } from "./profile-tab-favorites";
import { ProfileTabHistory } from "./profile-tab-history";
import type { UserProfileDto, UserProfileStatsDto } from "@/lib/db/profile";

export interface ProfileViewProps {
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
            <ProfileTabs activeTab={activeTab} onTabChange={setActiveTab} baseId={baseId} />

            <div className="flex-1 flex flex-col py-2">
              {activeTab === "checkins" && (
                <ProfileTabCheckins baseId={baseId} isAuthenticated={isAuthenticated} />
              )}
              {activeTab === "map" && (
                <ProfileTabCafes baseId={baseId} isAuthenticated={isAuthenticated} />
              )}
              {activeTab === "favorites" && (
                <ProfileTabFavorites baseId={baseId} />
              )}
              {activeTab === "history" && (
                <ProfileTabHistory baseId={baseId} />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
