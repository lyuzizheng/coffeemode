"use client";

import { useTranslations } from "next-intl";
import { useCountUp } from "@/hooks/use-count-up";
import type { UserProfileStatsDto } from "@/lib/db/profile";

export function ProfileStats({ stats }: { stats: UserProfileStatsDto | null }) {
  const t = useTranslations("profile");
  const animatedCafesCount = useCountUp(stats?.cafesCount ?? 0);
  const animatedCheckinsCount = useCountUp(stats?.checkinsCount ?? 0);

  return (
    <div className="w-full bg-surface border border-border rounded-xl p-4 my-4 flex items-center justify-around">
      <div className="flex flex-col items-center">
        <span className="font-mono font-bold text-2xl text-foreground tabular-nums">
          {animatedCafesCount}
        </span>
        <span className="text-xs text-muted font-medium mt-0.5">{t("stats_cafes")}</span>
      </div>
      <div className="w-px h-8 bg-border" />
      <div className="flex flex-col items-center">
        <span className="font-mono font-bold text-2xl text-foreground tabular-nums">
          {animatedCheckinsCount}
        </span>
        <span className="text-xs text-muted font-medium mt-0.5">{t("stats_checkins")}</span>
      </div>
    </div>
  );
}
