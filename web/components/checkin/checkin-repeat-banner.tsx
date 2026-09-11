"use client";

import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import type { LastCheckin } from "@/lib/checkin/last-checkin";

function formatLastVisit(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    // Benign: invalid date string degrades to raw YYYY-MM-DD prefix.
    return iso.slice(0, 10);
  }
}

interface CheckinRepeatBannerProps {
  lastCheckin: LastCheckin;
  onApplySame: () => void;
  onDismiss: () => void;
}

export function CheckinRepeatBanner({
  lastCheckin,
  onApplySame,
  onDismiss,
}: CheckinRepeatBannerProps) {
  const t = useTranslations("checkIn");

  return (
    <div className="flex items-center justify-between rounded-md bg-surface-secondary p-3">
      <span className="text-sm">{t("lastVisit", { date: formatLastVisit(lastCheckin.visited_at) })}</span>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onPress={onApplySame} className="h-7 rounded-sm px-3 text-xs">
          {t("same")}
        </Button>
        <Button variant="ghost" size="sm" onPress={onDismiss} className="h-7 rounded-sm px-3 text-xs">
          {t("new")}
        </Button>
        <button type="button" onClick={onDismiss} className="ml-1 text-muted hover:text-foreground" aria-label={t("dismiss")}>
          ×
        </button>
      </div>
    </div>
  );
}
