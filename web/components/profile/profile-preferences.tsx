"use client";

import { useTranslations } from "next-intl";
import { RankingPreferenceToggle } from "@/components/search/ranking-preference-toggle";
import { PublicIdentityToggle } from "./public-identity-toggle";
import type { UserProfileDto } from "@/lib/db/profile";

/**
 * Preferences — the last section of the authenticated /profile page
 * (profile-page-v2 §2). One grouped card collects every setting so the
 * page reads as a single axis: identity → data → settings. Identity rows
 * need a loaded profile; the ranking row is localStorage-backed (DG136)
 * and always renders.
 */
export function ProfilePreferences({
  profile,
  onProfileChange,
}: {
  profile: UserProfileDto | null;
  onProfileChange: (updated: UserProfileDto) => void;
}) {
  const t = useTranslations("profile");

  return (
    <section aria-label={t("preferences")} className="mt-6 flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted">{t("preferences")}</h2>
      <div className="divide-y divide-separator rounded-xl border border-border bg-surface">
        {profile && (
          <PublicIdentityToggle profile={profile} onProfileChange={onProfileChange} />
        )}
        <div className="px-4 py-3">
          <RankingPreferenceToggle variant="settings" />
        </div>
      </div>
    </section>
  );
}
