"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMounted } from "@/hooks/use-mounted";
import { ProfileHeader } from "./profile-header";
import { ProfileGate } from "./profile-gate";
import { ProfileHero } from "./profile-hero";
import { ProfileOnboardingCard } from "./profile-onboarding-card";
import { ProfileStats } from "./profile-stats";
import { ProfileTabs } from "./profile-tabs";
import { ProfileTabCheckins } from "./profile-tab-checkins";
import { ProfileTabCafes } from "./profile-tab-cafes";
import { ProfileTabFavorites } from "./profile-tab-favorites";
import { ProfileTabHistory } from "./profile-tab-history";
import { useProfileContent } from "./profile-hooks";
import type { UserProfileDto, UserProfileStatsDto } from "@/lib/db/profile";

interface ProfileViewProps {
  initialProfile: UserProfileDto | null;
  initialStats: UserProfileStatsDto | null;
  isAuthenticated: boolean;
  /** Signed-in display-name initial for the header's account button. */
  accountInitial?: string;
}

export function ProfileView({
  initialProfile,
  initialStats,
  isAuthenticated,
  accountInitial,
}: ProfileViewProps) {
  const [profile, setProfile] = useState<UserProfileDto | null>(initialProfile);
  const t = useTranslations("profile");
  const [stats] = useState<UserProfileStatsDto | null>(initialStats);
  const baseId = useId();
  const mounted = useMounted();
  const {
    activeTab,
    handleTabChange,
    checkinsQuery,
    cafesQuery,
    retryCheckinsFromFirstPage,
    retryCafesFromFirstPage,
    showGuide,
    dismissGuide,
  } = useProfileContent(isAuthenticated, mounted);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center">
      <ProfileHeader isAuthenticated={isAuthenticated} accountInitial={accountInitial} />

      <main className="w-full max-w-[var(--layout-content-max)] px-4 md:px-6 py-4 flex-1 flex flex-col">
        {!isAuthenticated ? (
          <ProfileGate />
        ) : (
          <>
            <ProfileHero profile={profile} onProfileChange={setProfile} />
            <ProfileStats stats={stats} />
            {showGuide ? (
              <ProfileOnboardingCard onSkip={dismissGuide} />
            ) : (
              <>
                <ProfileTabs activeTab={activeTab} onTabChange={handleTabChange} baseId={baseId} />
                <div className="flex-1 flex flex-col py-2">
                  {activeTab === "checkins" && (
                    <ProfileTabCheckins baseId={baseId} query={checkinsQuery} isAuthenticated={isAuthenticated} onRetry={retryCheckinsFromFirstPage} />
                  )}
                  {activeTab === "map" && (
                    <ProfileTabCafes baseId={baseId} query={cafesQuery} onRetry={retryCafesFromFirstPage} />
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
          </>
        )}
        {/* Settings live on /settings now (BRAWUKA-504) — the anonymous
            footer only carries a quiet pointer there. */}
        {!isAuthenticated && (
          <footer className="mt-auto border-t border-separator pt-3 pb-1">
            <Link
              href="/settings"
              className="cm-focus inline-flex min-h-11 items-center text-sm text-muted transition-colors hover:text-foreground"
            >
              {t("settings_link")}
            </Link>
          </footer>
        )}
      </main>
    </div>
  );
}

