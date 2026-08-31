"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import {
  subscribeRecentSearches,
  getRecentSearchesSnapshot,
  getRecentSearchesServerSnapshot,
  clearRecentSearches,
} from "@/lib/search/recent-searches";

type RelativeTimeKey = "just_now" | "minutes_ago" | "hours_ago" | "days_ago";

function formatRelativeTime(
  timestamp: number,
  t: (key: RelativeTimeKey, values?: Record<string, string | number>) => string,
): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return t("just_now");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("minutes_ago", { minutes: diffMin });
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return t("hours_ago", { hours: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays <= 7) return t("days_ago", { days: diffDays });
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function ProfileTabHistory({ baseId }: { baseId: string }) {
  const t = useTranslations("profile");

  const recentSearches = useSyncExternalStore(
    subscribeRecentSearches,
    getRecentSearchesSnapshot,
    getRecentSearchesServerSnapshot,
  );

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-history`}
      aria-labelledby={`${baseId}-tab-history`}
      className="flex flex-col gap-2"
    >
      {recentSearches.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-center">
          <p className="text-sm text-muted">{t("empty_history_title")}</p>
        </div>
      ) : (
        <>
          {recentSearches.map((item) => (
            <Link
              key={item.id}
              href="/"
              className="p-3 bg-surface border border-border rounded-xl flex items-center justify-between hover:border-border/80 active:scale-[0.99] transition-all"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted flex-shrink-0"
                >
                  <circle cx="7" cy="7" r="4.5" />
                  <path d="M10.5 10.5L14 14" />
                </svg>
                <span className="text-sm font-medium text-foreground truncate">
                  {item.query}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-surface-secondary text-[11px] text-muted">
                  {item.city}
                </span>
              </div>
              <span className="text-xs text-muted font-mono tabular-nums flex-shrink-0">
                {formatRelativeTime(item.timestamp, t)}
              </span>
            </Link>
          ))}
          <div className="flex justify-center pt-3">
            <Button
              size="sm"
              variant="outline"
              onPress={clearRecentSearches}
            >
              {t("clear_history")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
