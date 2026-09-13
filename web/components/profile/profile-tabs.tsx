"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type TabType = "checkins" | "map" | "favorites" | "history";
const TAB_ORDER: readonly TabType[] = ["checkins", "map", "favorites", "history"];

interface ProfileTabsProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  baseId: string;
}

type FadeEdge = "none" | "start" | "end" | "both";

const FADE_CLASS: Record<FadeEdge, string> = {
  none: "",
  start: "scroll-fade-start",
  end: "scroll-fade-end",
  both: "scroll-fade-x",
};

/**
 * Which edges of the tablist are clipped: "start" | "end" | "both" | "none".
 * Drives the mask fade that hints the strip scrolls — without it the 4th tab
 * looks like the strip simply ends (BRAWUKA-247).
 */
function useScrollEdgeFade() {
  const listRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<FadeEdge>("none");

  const updateFade = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const clippedStart = el.scrollLeft > 1;
    const clippedEnd = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade(
      clippedStart && clippedEnd ? "both" : clippedStart ? "start" : clippedEnd ? "end" : "none",
    );
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    updateFade();
    // jsdom has no ResizeObserver; browsers all do.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateFade]);

  return { listRef, fadeClass: FADE_CLASS[fade], updateFade };
}

/** Roving-tabindex arrow-key navigation per the tablist ARIA pattern. */
function handleTabKeyDown(
  e: React.KeyboardEvent,
  currentTab: TabType,
  onTabChange: (tab: TabType) => void,
  tabRefs: Map<TabType, HTMLButtonElement>,
) {
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
    tabRefs.get(nextTab)?.focus();
  }
}

export function ProfileTabs({ activeTab, onTabChange, baseId }: ProfileTabsProps) {
  const t = useTranslations("profile");
  const tabRefs = useRef<Map<TabType, HTMLButtonElement>>(new Map());
  const { listRef, fadeClass, updateFade } = useScrollEdgeFade();

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={t("title")}
      onScroll={updateFade}
      className={`flex items-center gap-1 p-1 bg-surface-secondary rounded-xl my-4 overflow-x-auto no-scrollbar ${fadeClass}`}
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
            onKeyDown={(e) => handleTabKeyDown(e, tabKey, onTabChange, tabRefs.current)}
            className="group -my-1.5 flex min-h-11 flex-1 items-center justify-center"
          >
            <span
              className={`min-w-[90px] rounded-lg px-3 py-2 text-center text-xs font-medium whitespace-nowrap transition-all ${
                isSelected
                  ? "bg-surface text-foreground shadow-sm font-semibold"
                  : "text-muted group-hover:text-foreground"
              }`}
            >
              {t(`tab_${tabKey}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
