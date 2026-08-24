"use client";

/**
 * Desktop discovery (≥1024px, artifact §7, DG42/18g): 380px cafe-list
 * sidebar + a second left column (400px) with the FULL detail composition;
 * the map keeps the remaining width. The mobile snap states never appear
 * here. The detail column opens with a 200ms slide-in and closes with Esc
 * or the ghost ×.
 */
import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { duration, ease } from "@/lib/motion";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import type { CafeSummary } from "@/types/cafes";
import { CafeCardBody } from "./cafe-card";
import { DetailContent } from "./detail-content";

function SidebarSkeletons() {
  return (
    <div className="flex flex-col gap-2 p-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3 rounded-md border border-separator bg-surface p-3">
          <div className="h-[66px] w-[88px] animate-pulse rounded-md bg-surface-tertiary" />
          <div className="flex flex-1 flex-col justify-center gap-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-tertiary" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-tertiary" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DesktopDiscovery({
  controller,
  cafes,
  isLoading,
  onCheckIn,
  addCafe,
}: {
  controller: DiscoveryController;
  cafes: CafeSummary[];
  isLoading: boolean;
  onCheckIn: () => void;
  addCafe: ReactNode;
}) {
  const t = useTranslations("discovery");
  const reduced = useReducedMotion();
  const { selectedCafeId, close } = controller;

  // Esc closes the detail column (§7).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return (
    <div className="fixed inset-y-0 left-0 z-30 flex" role="region" aria-label={t("sheet_aria")}>
      <aside className="flex h-full w-[380px] shrink-0 flex-col border-r border-separator bg-surface">
        {/* Reserved 48px search/filter row — internals belong to search-filters. */}
        <div className="h-12 shrink-0 border-b border-separator" aria-hidden />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <SidebarSkeletons />
          ) : cafes.length === 0 ? (
            <div className="flex flex-col items-start gap-2 p-4">
              <p className="font-display text-lg font-bold text-foreground">
                {t("empty_nearby_title")}
              </p>
              <p className="text-sm text-muted">{t("empty_nearby_body")}</p>
              {addCafe}
            </div>
          ) : (
            <ul className="flex flex-col gap-2 p-3" aria-label={t("peek_aria")}>
              {cafes.map((cafe) => {
                const selected = cafe.id === selectedCafeId;
                return (
                  <li key={cafe.id}>
                    <button
                      ref={(el) => controller.registerCardRef(cafe.id, el)}
                      type="button"
                      onClick={() => controller.select(cafe.id)}
                      aria-current={selected || undefined}
                      className={`block w-full rounded-md text-left transition-colors ${
                        selected
                          ? "bg-surface-secondary shadow-[inset_2px_0_0_0_var(--accent)]"
                          : "hover:bg-surface-secondary/60"
                      }`}
                    >
                      <CafeCardBody cafe={cafe} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <AnimatePresence>
        {selectedCafeId && (
          <motion.div
            key={selectedCafeId}
            initial={reduced ? false : { x: -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduced ? undefined : { x: -24, opacity: 0 }}
            transition={{ duration: reduced ? 0 : duration.state, ease: ease.default }}
            className="h-full w-[400px] shrink-0 overflow-y-auto border-l border-separator bg-overlay py-4"
          >
            <DetailContent
              cafeId={selectedCafeId}
              variant="full"
              controller={controller}
              onCheckIn={onCheckIn}
              onClose={close}
              distanceM={cafes.find((c) => c.id === selectedCafeId)?.distance_m}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
