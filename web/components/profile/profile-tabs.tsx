"use client";

import { useCallback, useRef } from "react";
import { useTranslations } from "next-intl";

export type TabType = "checkins" | "map" | "favorites" | "history";
export const TAB_ORDER: readonly TabType[] = ["checkins", "map", "favorites", "history"];

interface ProfileTabsProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  baseId: string;
}

export function ProfileTabs({ activeTab, onTabChange, baseId }: ProfileTabsProps) {
  const t = useTranslations("profile");
  const tabRefs = useRef<Map<TabType, HTMLButtonElement>>(new Map());

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, currentTab: TabType) => {
      const currentIndex = TAB_ORDER.indexOf(currentTab);
      let nextIndex = -1;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % TAB_ORDER.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIndex = TAB_ORDER.length - 1;
      }

      if (nextIndex >= 0) {
        const nextTab = TAB_ORDER[nextIndex];
        onTabChange(nextTab);
        tabRefs.current.get(nextTab)?.focus();
      }
    },
    [onTabChange],
  );

  return (
    <div
      role="tablist"
      aria-label={t("title")}
      className="flex items-center gap-1 p-1 bg-surface-secondary rounded-xl my-4 overflow-x-auto no-scrollbar"
    >
      {TAB_ORDER.map((tabKey) => {
        const isSelected = activeTab === tabKey;
        return (
          <button
            key={tabKey}
            ref={(el) => {
              if (el) tabRefs.current.set(tabKey, el);
              else tabRefs.current.delete(tabKey);
            }}
            role="tab"
            id={`${baseId}-tab-${tabKey}`}
            aria-selected={isSelected}
            aria-controls={`${baseId}-panel-${tabKey}`}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onTabChange(tabKey)}
            onKeyDown={(e) => handleTabKeyDown(e, tabKey)}
            className={`flex-1 min-w-[90px] py-2 px-3 text-xs font-medium rounded-lg transition-all text-center whitespace-nowrap ${
              isSelected
                ? "bg-surface text-foreground shadow-xs font-semibold"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t(`tab_${tabKey}`)}
          </button>
        );
      })}
    </div>
  );
}
