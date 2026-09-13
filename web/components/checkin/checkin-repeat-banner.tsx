"use client";

import { Button } from "@heroui/react";
import { useLocale, useTranslations } from "next-intl";
import type { LastCheckin } from "@/lib/checkin/last-checkin";

function formatLastVisit(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
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
  const locale = useLocale();

  return (
    <div className="flex items-center justify-between rounded-md bg-surface-secondary p-3">
      <span className="text-sm">{t("lastVisit", { date: formatLastVisit(lastCheckin.visited_at, locale) })}</span>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onPress={onApplySame} className="-my-2 rounded-sm px-3 text-xs">
          {t("same")}
        </Button>
        <Button variant="ghost" size="sm" onPress={onDismiss} className="-my-2 rounded-sm px-3 text-xs">
          {t("new")}
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          className="-m-2 ml-1 flex h-11 w-11 items-center justify-center text-muted hover:text-foreground"
          aria-label={t("dismiss")}
        >
          ×
        </button>
      </div>
    </div>
  );
}
