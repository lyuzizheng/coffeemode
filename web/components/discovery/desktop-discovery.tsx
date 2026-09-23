"use client";

/**
 * Desktop discovery (≥1024px, artifact §7, DG42/18g; BRAWUKA-364 field-guide
 * redesign; BRAWUKA-506 dual-state sidebar): the sidebar is the guide's
 * index — a two-state narrative column (brand frontispiece ↔ compact
 * masthead + search + hairline rows, see desktop-sidebar.tsx). A second
 * left column (--layout-detail-column) carries the FULL dossier; the map
 * keeps the remaining width. The mobile snap states never appear here. The
 * detail column slides in on the snappy spring (state settle budget ≤300ms,
 * spec 0002 Motion) and closes with Esc or the ×.
 *
 * While a search query is active the index list yields to the result
 * groups; selecting a result selects the cafe (or opens creation for a
 * POI). SSR contract (#275): when surface children are present, the
 * sidebar shell renders on every pass — CSS-gated (`hidden lg:flex`) — so
 * SSR already reserves the --layout-aside-column width and neither mounting nor crossing
 * the 1024px breakpoint ever re-parents or shifts the surface subtree.
 * `showColumns` gates only the interactive content (list/detail), never
 * the tree shape. Below 1280px the detail column overlays the surface
 * instead of squeezing it below its content width.
 */
import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useSprings } from "@/lib/motion";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import type { CafeSummary } from "@/types/cafes";
import type { DiscoverySearch } from "./use-discovery-search";
import { DetailContent } from "./detail-content";
import { DesktopSidebar } from "./desktop-sidebar";

export function DesktopDiscovery({
  controller,
  cafes,
  isLoading,
  isError,
  onRetry,
  onCheckIn,
  addCafe,
  children,
  showColumns = true,
  search,
  distanceM,
}: {
  controller: DiscoveryController;
  cafes: CafeSummary[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onCheckIn: (cafeId?: string, cafeName?: string) => void;
  addCafe: ReactNode;
  children?: ReactNode;
  /** Landing mode only: gates the interactive column content so the shell
   * itself can render before mount (SSR contract #275). Unused standalone. */
  showColumns?: boolean;
  /** Live unified search wiring (BRAWUKA-364 + BRAWUKA-512 filters): flags,
   * state, and selection handlers owned by the discovery adapter. Absent →
   * the field is not rendered. */
  search?: DiscoverySearch;
  /** Meters from the query point for the selected cafe — resolved by the
   * adapter (search picks may sit outside the nearby list). */
  distanceM?: number;
}) {
  const t = useTranslations("discovery");
  const reduced = useReducedMotion();
  const springs = useSprings();
  const { selectedCafeId, close } = controller;

  // Esc closes the detail column (§7) — but only when no layer above it
  // consumed the key. Menus/popovers/drawers attach at document-or-deeper
  // and preventDefault on Esc; this window listener is the last handler in
  // the bubble path, so defaultPrevented here means a higher layer already
  // took the key (BRAWUKA-576).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  // Standalone mode has no shell contract — content always shows.
  const contentVisible = !children || showColumns;

  const discoveryColumns = (
    <div
      className={
        children
          ? "sticky top-0 h-dvh z-30 hidden shrink-0 lg:flex"
          : "fixed inset-y-0 left-0 z-30 flex shrink-0"
      }
      role="region"
      aria-label={t("sheet_aria")}
    >
      <aside className="flex h-full w-[var(--layout-aside-column)] shrink-0 flex-col border-r border-separator bg-surface">
        <DesktopSidebar
          contentVisible={contentVisible}
          isLoading={isLoading}
          isError={isError}
          cafes={cafes}
          onRetry={onRetry}
          addCafe={addCafe}
          search={search}
          controller={controller}
        />
      </aside>

      {contentVisible && (
        <AnimatePresence>
          {selectedCafeId && (
            <motion.div
              key={selectedCafeId}
              initial={reduced ? false : { x: -24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={reduced ? undefined : { x: -24, opacity: 0 }}
              transition={reduced ? { duration: 0 } : springs.snappy}
              className="absolute inset-y-0 left-[var(--layout-aside-column)] h-full w-[var(--layout-detail-column)] shrink-0 overflow-y-auto border-l border-separator bg-overlay py-4 shadow-lg xl:static xl:shadow-none"
            >
              <DetailContent
                cafeId={selectedCafeId}
                variant="full"
                controller={controller}
                onCheckIn={onCheckIn}
                onClose={close}
                distanceM={distanceM}
              />
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );

  if (!children) return discoveryColumns;

  return (
    <div className="flex min-h-dvh w-full">
      {discoveryColumns}
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
