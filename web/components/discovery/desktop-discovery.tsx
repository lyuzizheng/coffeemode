"use client";

/**
 * Desktop discovery (≥1024px, artifact §7, DG42/18g; BRAWUKA-364 field-guide
 * redesign): the sidebar is the guide's index — a masthead (wordmark +
 * tagline + add-cafe), the live unified search field, and the nearby list
 * printed as hairline rows. A second left column (--layout-detail-column) carries the FULL
 * dossier; the map keeps the remaining width. The mobile snap states never
 * appear here. The detail column slides in on the snappy spring (state
 * settle budget ≤300ms, spec 0002 Motion) and closes with Esc or the ×.
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
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useSprings } from "@/lib/motion";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import type { CafeSummary } from "@/types/cafes";
import type { SearchResultItem } from "@/lib/search/types";
import type { ExternalSourceFlags } from "@/lib/client-env";
import { UnifiedSearchPanel } from "@/components/search/unified-search-panel";
import type { ExternalSearchProvider } from "@/components/search/search-results-list";
import { CafeCardBody } from "./cafe-card";
import { DetailContent } from "./detail-content";
import { InlineError } from "./inline-error";
import { SectionLabel } from "./section-label";

function SidebarSkeletons() {
  return (
    <div className="flex flex-col" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 border-b border-separator p-3">
          <div className="h-[var(--layout-row-cover-h)] w-[var(--layout-row-cover-w)] animate-pulse rounded-sm bg-surface-tertiary" />
          <div className="flex flex-1 flex-col justify-center gap-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-tertiary" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-tertiary" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-surface-tertiary" />
          </div>
          <div className="h-10 w-11 shrink-0 self-center animate-pulse rounded bg-surface-tertiary" />
        </div>
      ))}
    </div>
  );
}

/** Masthead — the guide's nameplate: wordmark, tagline, add-cafe action. */
function Masthead({ addCafe }: { addCafe: ReactNode }) {
  const t = useTranslations("discovery");
  return (
    <div className="flex items-start justify-between gap-3 border-b border-separator px-4 pb-3 pt-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-display text-lg font-extrabold tracking-tight text-foreground">
          CafeMood
        </span>
        <span className="text-xs text-muted">{t("tagline")}</span>
      </div>
      <div className="shrink-0 pt-0.5">{addCafe}</div>
    </div>
  );
}

/** The index: a labeled, hairline-separated register of nearby cafes. */
function IndexList({
  cafes,
  controller,
}: {
  cafes: CafeSummary[];
  controller: DiscoveryController;
}) {
  const t = useTranslations("discovery");
  const { selectedCafeId } = controller;
  return (
    <>
      <div className="px-4 pt-3">
        <SectionLabel>{t("index_label", { count: cafes.length })}</SectionLabel>
      </div>
      <ul className="flex flex-col" aria-label={t("peek_aria")}>
        {cafes.map((cafe) => {
          const selected = cafe.id === selectedCafeId;
          return (
            <li key={cafe.id} className="border-b border-separator last:border-b-0">
              <button
                ref={(el) => controller.registerCardRef(cafe.id, el)}
                type="button"
                onClick={() => controller.select(cafe.id)}
                aria-current={selected || undefined}
                className={`block w-full text-left transition-colors ${
                  selected
                    ? "bg-surface-secondary shadow-[inset_2px_0_0_0_var(--accent)]"
                    : "hover:bg-surface-secondary/60"
                }`}
              >
                <CafeCardBody cafe={cafe} variant="row" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Sidebar scroll body: skeletons → error → empty state → the index. */
function SidebarBody({
  contentVisible,
  isLoading,
  isError,
  cafes,
  onRetry,
  addCafe,
  searchActive,
  controller,
}: {
  contentVisible: boolean;
  isLoading: boolean;
  isError: boolean;
  cafes: CafeSummary[];
  onRetry: () => void;
  addCafe: ReactNode;
  searchActive: boolean;
  controller: DiscoveryController;
}) {
  const t = useTranslations("discovery");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {!contentVisible || isLoading ? (
        <SidebarSkeletons />
      ) : isError && cafes.length === 0 ? (
        // BRAWUKA-231: a failed fetch must not masquerade as "no cafes nearby".
        <div className="p-3">
          <InlineError message={t("nearby_load_failed")} onRetry={onRetry} />
        </div>
      ) : cafes.length === 0 ? (
        <div className="flex flex-col items-start gap-2 p-4">
          <p className="font-display text-lg font-bold text-foreground">
            {t("empty_nearby_title")}
          </p>
          <p className="text-sm text-muted">{t("empty_nearby_body")}</p>
          {addCafe}
        </div>
      ) : searchActive ? null : (
        <IndexList cafes={cafes} controller={controller} />
      )}
    </div>
  );
}

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
  /** Live unified search wiring (BRAWUKA-364): flags + selection handlers
   * owned by the discovery adapter. Absent → the field is not rendered. */
  search?: {
    externalSources: ExternalSourceFlags;
    mapkitConfigured: boolean;
    city?: string;
    onSelectResult: (item: SearchResultItem) => void;
    onExternalSearch: (provider: ExternalSearchProvider) => void;
  };
  /** Meters from the query point for the selected cafe — resolved by the
   * adapter (search picks may sit outside the nearby list). */
  distanceM?: number;
}) {
  const t = useTranslations("discovery");
  const reduced = useReducedMotion();
  const springs = useSprings();
  const { selectedCafeId, close } = controller;
  const [searchQuery, setSearchQuery] = useState("");
  const searchActive = searchQuery.trim().length > 0;

  // Esc closes the detail column (§7).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
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
        <Masthead addCafe={addCafe} />
        {search && contentVisible && (
          <div className="border-b border-separator px-4 py-3">
            <UnifiedSearchPanel
              externalSources={search.externalSources}
              mapkitConfigured={search.mapkitConfigured}
              city={search.city}
              onSelectResult={search.onSelectResult}
              onExternalSearch={search.onExternalSearch}
              onQueryChange={setSearchQuery}
              hideIdleHint
              resultsClassName="max-h-[50dvh] overflow-y-auto overscroll-contain"
            />
          </div>
        )}
        <SidebarBody
          contentVisible={contentVisible}
          isLoading={isLoading}
          isError={isError}
          cafes={cafes}
          onRetry={onRetry}
          addCafe={addCafe}
          searchActive={searchActive}
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
