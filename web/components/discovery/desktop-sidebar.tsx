"use client";

/**
 * Desktop discovery sidebar (BRAWUKA-506): the 380px index column is a
 * two-state narrative — at scroll-top a centered brand frontispiece
 * (eyebrow + wordmark + manifesto intro) fills the upper column; scrolling
 * slides it under the compact masthead, whose wordmark/tagline/add-cafe
 * fade in as the index takes over. Search activation or a selected cafe
 * force the panel to yield (spring collapse) until the detail closes AND
 * the column returns to scroll-top.
 *
 * Mechanics — no third-party scroll library: `useScroll` on the column's
 * own overflow container drives the masthead fades (scroll-linked,
 * interruptible, reversible); `collapse` (0 = open, 1 = closed) is a
 * MotionValue animated by `spring.gentle` for forced collapse/expand and
 * composed with scroll progress via `useTransform`. The forced state
 * latches (holdRef) so closing the detail mid-list doesn't yank the panel
 * open; it releases only at scroll-top (≤8px). prefers-reduced-motion →
 * static compact masthead, no panel (spec 0002 §Motion).
 *
 * Spacing scale (BRAWUKA-506 §2): every sidebar element shares `px-4`
 * (16px) — masthead, search, section label, cafe rows, skeletons,
 * empty/error states. Vertical rhythm rides the 4px grid: masthead 72px
 * (--layout-masthead-h), search py-3, label pt-3, rows py-3. Skeletons
 * mirror real row geometry (BRAWUKA-420).
 *
 * SSR contract (#275): the initial render IS the scroll-top expanded
 * state — the panel renders open (unless a cafe is already selected via
 * deep link), so SSR→hydration never shifts layout.
 */
import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useTranslations } from "next-intl";
import { duration, ease, spring } from "@/lib/motion";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import type { CafeSummary } from "@/types/cafes";
import { UnifiedSearchPanel } from "@/components/search/unified-search-panel";
import type { DiscoverySearch } from "./use-discovery-search";
import { CafeCardBody } from "./cafe-card";
import { InlineError } from "./inline-error";
import { SectionLabel } from "./section-label";

/** Brand panel geometry: min(46dvh, 400px) — the frontispiece never eats
 * more than ~half the column height, so the first index rows always peek
 * below it. The spring animates maxHeight to a ceiling (400px) so the
 * overshoot tail lands past the real content height — no measuring. */
const BRAND_PANEL_MAX_H_PX = 400;
/** Scroll distance over which the masthead fades in behind the panel. */
const MASTHEAD_FADE_PX = 32;
/** scrollTop at/below this releases the forced-collapse latch. */
const TOP_RELEASE_PX = 8;

/** Sidebar spacing scale — the single horizontal gutter (16px). */
const GUTTER = "px-4";

/** Collapse orchestration: `collapse` (0 = frontispiece open, 1 = closed)
 * is driven imperatively — the latch lives in refs, so no setState ever
 * runs inside an effect. `forced` sets the latch; only scroll-top releases. */
function useBrandCollapse(
  scrollRef: RefObject<HTMLDivElement | null>,
  forced: boolean,
  reduced: boolean,
): { collapse: MotionValue<number>; onScroll: () => void } {
  const collapse = useMotionValue(forced ? 1 : 0);
  const forcedRef = useRef(forced);
  const holdRef = useRef(forced);

  const sync = useCallback(() => {
    const target = forcedRef.current || holdRef.current ? 1 : 0;
    if (reduced) collapse.set(target);
    else animate(collapse, target, spring.gentle);
  }, [collapse, reduced]);

  useEffect(() => {
    forcedRef.current = forced;
    if (forced) holdRef.current = true;
    else if ((scrollRef.current?.scrollTop ?? 0) <= TOP_RELEASE_PX) {
      // Forced ended while already at top — release immediately; no scroll
      // event is coming to do it.
      holdRef.current = false;
    }
    sync();
  }, [forced, reduced, scrollRef, sync]);

  const onScroll = useCallback(() => {
    if (holdRef.current && (scrollRef.current?.scrollTop ?? 0) <= TOP_RELEASE_PX) {
      holdRef.current = false;
      sync();
    }
  }, [scrollRef, sync]);

  return { collapse, onScroll };
}

function SidebarSkeletons() {
  return (
    <div className="flex flex-col" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`flex gap-3 border-b border-separator ${GUTTER} py-3`}>
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

/** Compact masthead — sticky; transparent while the brand panel is open,
 * fades in as the index scrolls under it (or when the panel yields to
 * search/detail). Visibility = max(scroll progress, forced collapse). */
function SidebarMasthead({
  addCafe,
  scrollY,
  collapse,
  reduced,
}: {
  addCafe: ReactNode;
  scrollY: MotionValue<number>;
  collapse: MotionValue<number>;
  reduced: boolean;
}) {
  const t = useTranslations("discovery");
  const bgOpacity = useTransform(() =>
    Math.max(Math.min(scrollY.get() / MASTHEAD_FADE_PX, 1), collapse.get()),
  );
  const contentOpacity = useTransform(() =>
    Math.max(Math.min(Math.max(scrollY.get() - 8, 0) / 48, 1), collapse.get()),
  );
  const contentY = useTransform(() => (1 - contentOpacity.get()) * 6);
  const contentVisibility = useTransform(contentOpacity, (v) =>
    v < 0.02 ? "hidden" : "visible",
  );
  return (
    <div className="sticky top-0 z-20">
      <motion.div
        aria-hidden
        style={{ opacity: reduced ? 1 : bgOpacity }}
        className="absolute inset-0 border-b border-separator bg-surface"
      />
      <motion.div
        style={
          reduced
            ? undefined
            : { opacity: contentOpacity, y: contentY, visibility: contentVisibility }
        }
      >
        <div
          className={`flex h-[var(--layout-masthead-h)] items-center justify-between gap-3 ${GUTTER}`}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-display text-lg font-extrabold tracking-tight text-foreground">
              CafeMood
            </span>
            <span className="text-xs text-muted">{t("tagline")}</span>
          </div>
          <div className="shrink-0">{addCafe}</div>
        </div>
      </motion.div>
    </div>
  );
}

/** The frontispiece — centered brand panel rendered in flow at scroll-top.
 * Forced collapse (search/detail) springs maxHeight to 0; visibility:hidden
 * at rest keeps it out of the a11y tree and hit-testing. */
function BrandPanel({ collapse }: { collapse: MotionValue<number> }) {
  const t = useTranslations("discovery");
  const tOnboarding = useTranslations("onboarding");
  const maxHeight = useTransform(collapse, (c) => (1 - c) * BRAND_PANEL_MAX_H_PX);
  const visibility = useTransform(collapse, (c) => (c >= 1 ? "hidden" : "visible"));
  return (
    <motion.div style={{ maxHeight, visibility }} className="overflow-hidden">
      <div className="relative flex h-[min(46dvh,400px)] flex-col items-center justify-center gap-3 overflow-hidden px-6 text-center">
        <div aria-hidden className="grain-overlay absolute inset-0" />
        <span className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-muted">
          {tOnboarding("field_guide_mark")}
        </span>
        <span className="font-display text-2xl font-extrabold tracking-tight text-foreground">
          CafeMood
        </span>
        <p className="max-w-[26ch] text-sm leading-relaxed text-muted">{t("brand_intro")}</p>
      </div>
    </motion.div>
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
      <div className={`${GUTTER} pt-3`}>
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

/** Content states — keyed so AnimatePresence can crossfade between them
 * (BRAWUKA-506 §3: skeleton → content never hard-cuts). */
type SidebarState = "loading" | "error" | "empty" | "search" | "list";

function sidebarState(opts: {
  contentVisible: boolean;
  isLoading: boolean;
  isError: boolean;
  cafes: CafeSummary[];
  searchActive: boolean;
}): SidebarState {
  if (!opts.contentVisible || opts.isLoading) return "loading";
  // BRAWUKA-231: a failed fetch must not masquerade as "no cafes nearby".
  if (opts.isError && opts.cafes.length === 0) return "error";
  if (opts.cafes.length === 0) return "empty";
  if (opts.searchActive) return "search";
  return "list";
}

function SidebarContent(props: {
  state: SidebarState;
  reduced: boolean;
  cafes: CafeSummary[];
  controller: DiscoveryController;
  onRetry: () => void;
  addCafe: ReactNode;
}) {
  const { state, reduced, cafes, controller, onRetry, addCafe } = props;
  const t = useTranslations("discovery");
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.div
        key={state}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={reduced ? { duration: 0 } : { duration: duration.state, ease: ease.default }}
      >
        {state === "loading" ? (
          <SidebarSkeletons />
        ) : state === "error" ? (
          <div className={`${GUTTER} py-3`}>
            <InlineError message={t("nearby_load_failed")} onRetry={onRetry} />
          </div>
        ) : state === "empty" ? (
          <div className={`flex flex-col items-start gap-2 ${GUTTER} py-4`}>
            <p className="font-display text-lg font-bold text-foreground">
              {t("empty_nearby_title")}
            </p>
            <p className="text-sm text-muted">{t("empty_nearby_body")}</p>
            {addCafe}
          </div>
        ) : state === "list" ? (
          <IndexList cafes={cafes} controller={controller} />
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}

/** Live unified search wiring (BRAWUKA-364 + BRAWUKA-512 filters). Absent →
 * no search field. The shape is the shared `DiscoverySearch` contract —
 * query/filters/city are owned by `useDiscoverySearch`. */
type SidebarSearchProps = DiscoverySearch;

/** Sticky search row — docks directly under the compact masthead. */
function SidebarSearch({ search }: { search: SidebarSearchProps }) {
  return (
    <div
      className={`sticky top-[var(--layout-masthead-h)] z-10 border-b border-separator bg-surface ${GUTTER} py-3`}
    >
      <UnifiedSearchPanel
        externalSources={search.externalSources}
        mapkitConfigured={search.mapkitConfigured}
        city={search.city}
        query={search.query}
        onSelectResult={search.onSelectResult}
        onExternalSearch={search.onExternalSearch}
        onQueryChange={search.onQueryChange}
        filters={search.filters}
        onFiltersChange={search.onFiltersChange}
        onCityChange={search.onCityChange}
        hideIdleHint
        resultsClassName="max-h-[50dvh] overflow-y-auto overscroll-contain"
      />
    </div>
  );
}

export function DesktopSidebar({
  contentVisible,
  isLoading,
  isError,
  cafes,
  onRetry,
  addCafe,
  search,
  controller,
}: {
  /** Landing mode only: gates the interactive column content so the shell
   * itself can render before mount (SSR contract #275). */
  contentVisible: boolean;
  isLoading: boolean;
  isError: boolean;
  cafes: CafeSummary[];
  onRetry: () => void;
  addCafe: ReactNode;
  search?: SidebarSearchProps;
  controller: DiscoveryController;
}) {
  const reduced = useReducedMotion() ?? false;
  // The hook owns the query/filters — active filters also yield the index
  // to the results surface (browse mode, BRAWUKA-512).
  const searchActive = search?.searchActive ?? false;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { scrollY } = useScroll({ container: scrollRef });

  /** Forced yield: search results or the detail column own the focus, so
   * the brand panel collapses out of the way (BRAWUKA-506 §1 coexistence). */
  const forced = searchActive || controller.selectedCafeId !== null;
  const { collapse, onScroll } = useBrandCollapse(scrollRef, forced, reduced);
  const state = sidebarState({ contentVisible, isLoading, isError, cafes, searchActive });

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      <SidebarMasthead
        addCafe={addCafe}
        scrollY={scrollY}
        collapse={collapse}
        reduced={reduced}
      />
      {!reduced && <BrandPanel collapse={collapse} />}
      {search && contentVisible && <SidebarSearch search={search} />}
      <SidebarContent
        state={state}
        reduced={reduced}
        cafes={cafes}
        controller={controller}
        onRetry={onRetry}
        addCafe={addCafe}
      />
    </div>
  );
}
