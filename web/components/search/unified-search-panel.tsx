"use client";

/**
 * Unified map-independent search panel (search-filters-v1 §3/§6/§7):
 * search-as-you-type per `search.client` (DG44/DG47),
 * top-10 results rendered as DG131 groups via `SearchResultsList`, and
 * first-class states — hint before typing, 4-row skeleton on first load,
 * inline error + retry with the last good list preserved (DG141).
 *
 * Filter surface (BRAWUKA-512, DG44–DG58): a city scope chip at the left
 * end of the row (DG50), a Filter button with active-count badge at the
 * right end, a HeroUI bottom sheet on mobile / inline collapsible section
 * on desktop, and removable chips above results (DG54). Filter state is
 * owned by the host (`useDiscoverySearch`) — the panel is a controlled
 * view, so badge, chips, URL, and emitted params never disagree. Active
 * filters also unlock browse-mode fetch with an empty query.
 *
 * It holds no map object and talks only to `GET /api/search`; plotting
 * results onto the map stays with map-discovery-integration.
 */
import { Drawer, SearchField } from "@heroui/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSearchDebounceMs, getSearchMinQueryLength } from "@/lib/client-env";
import type { ExternalSourceFlags } from "@/lib/client-env";
import { useMediaQuery } from "@/hooks/use-media-query";
import { addRecentSearch } from "@/lib/search/recent-searches";
import { fetchUnifiedSearch, type UnifiedSearchParams } from "@/lib/search/search-client";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  type SearchFilterState,
} from "@/lib/search/search-filters";
import type { SearchResponse, SearchResultItem } from "@/lib/search/types";
import {
  ActiveFilterChips,
  CityScopeSelect,
  FilterButton,
  SearchFilterControls,
} from "./search-filter-ui";
import {
  SearchResultsList,
  type ExternalSearchProvider,
} from "./search-results-list";

/** Search-as-you-type trigger (DG44) and debounce (DG47), owned by `app.yaml` `search.client`. */
const MIN_QUERY_LENGTH = getSearchMinQueryLength();
const DEBOUNCE_MS = getSearchDebounceMs();

type SearchStatus = "idle" | "loading" | "success" | "error";

function SearchSkeletons() {
  return (
    <div className="flex flex-col gap-2 px-3 pt-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-1.5 py-1.5">
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface-tertiary" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-tertiary" />
        </div>
      ))}
    </div>
  );
}

interface UnifiedSearchPanelProps {
  externalSources: ExternalSourceFlags;
  /** DG143 gate — request-time MapKit readiness passed by the server page. */
  mapkitConfigured: boolean;
  /** Effective city scope; omitted → server header/default resolution (DG128). */
  city?: string;
  /** Controlled query — hosts that own search state pass it; absent → the
   * panel keeps its own field state (theme-preview, tests). */
  query?: string;
  onSelectResult: (item: SearchResultItem) => void;
  onExternalSearch: (provider: ExternalSearchProvider) => void;
  /**
   * DI seam for the DG140 fixtures/MSW path and tests; defaults to the real
   * `/api/search` client. Production surfaces never pass this.
   */
  fetchSearch?: (params: UnifiedSearchParams) => Promise<SearchResponse>;
  /** BRAWUKA-364: hosts that swap their list for results need the live
   * query state — fired on every field change ("" included). Doubles as the
   * controlled-query setter when `query` is passed. */
  onQueryChange?: (query: string) => void;
  /** Filter state + setter — both required for the filter UI to render
   * (DG44–DG58). Absent → the row is field-only (theme-preview). */
  filters?: SearchFilterState;
  onFiltersChange?: (next: SearchFilterState) => void;
  /** City scope chip setter — renders the `Singapore ▾` chip (DG50). */
  onCityChange?: (cityId: string) => void;
  /** Extra classes on the results region (e.g. bounded scroll in a column). */
  resultsClassName?: string;
  /** Drop the idle hint line — hosts that show their own list under the
   * field don't need the placeholder repeated. */
  hideIdleHint?: boolean;
}

/** The filter surface — one control set, two presentations (spec §3):
 * mobile gets the HeroUI bottom sheet, desktop the inline section. */
function FilterSurface({
  isDesktop,
  open,
  onOpenChange,
  filters,
  resultCount,
  onFiltersChange,
}: {
  isDesktop: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: SearchFilterState;
  resultCount: number | null;
  onFiltersChange: (next: SearchFilterState) => void;
}) {
  const t = useTranslations("search");
  const reduced = useReducedMotion() ?? false;
  const controls = (
    <SearchFilterControls
      filters={filters}
      resultCount={resultCount}
      onFiltersChange={onFiltersChange}
      onReset={() => onFiltersChange(EMPTY_FILTERS)}
    />
  );

  if (isDesktop) {
    return (
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="filters"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-separator px-1 pt-2">{controls}</div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <Drawer.Root isOpen={open} onOpenChange={onOpenChange}>
      {/* Content MUST nest inside Backdrop — sibling placement leaks the
          backdrop (BRAWUKA-371, see checkin-drawer.tsx). */}
      <Drawer.Backdrop>
        <Drawer.Content placement="bottom" className="max-h-[85dvh] bg-overlay text-foreground">
          <Drawer.Dialog
            aria-label={t("filters")}
            className="flex max-h-[85dvh] flex-col"
          >
            <Drawer.Handle />
            <Drawer.Body className="overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {controls}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer.Root>
  );
}

export function UnifiedSearchPanel({
  externalSources,
  mapkitConfigured,
  city,
  query: queryProp,
  onSelectResult,
  onExternalSearch,
  fetchSearch,
  onQueryChange,
  filters,
  onFiltersChange,
  onCityChange,
  resultsClassName,
  hideIdleHint = false,
}: UnifiedSearchPanelProps) {
  const t = useTranslations("search");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [internalQuery, setInternalQuery] = useState("");
  const query = queryProp ?? internalQuery;
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const requestId = useRef(0);
  const fetcher = fetchSearch ?? fetchUnifiedSearch;
  const filterUi = filters !== undefined && onFiltersChange !== undefined;
  const filtersActive = filterUi && hasActiveFilters(filters);

  // BRAWUKA-364: the host mirrors the field value so it can swap its own
  // list for results while a query is active.
  const handleQueryChange = useCallback(
    (next: string) => {
      if (queryProp === undefined) setInternalQuery(next);
      onQueryChange?.(next);
    },
    [onQueryChange, queryProp],
  );

  // Below the minimum-query trigger (DG44) the panel is idle by derivation —
  // unless filters are active: browse mode fetches with an empty `q` so the
  // chips always have a live list behind them. Stale in-flight requests are
  // invalidated via the request id.
  const wantsResults = query.trim().length >= MIN_QUERY_LENGTH || filtersActive;
  const effectiveStatus: SearchStatus = wantsResults ? status : "idle";

  // One runner for both the debounced effect and manual retry. Stale
  // responses are discarded via the request id; a successful prior status is
  // kept during refetch so skeletons never flash over real content (DG141).
  const runSearch = useCallback(
    (trimmed: string, signal?: AbortSignal) => {
      const id = ++requestId.current;
      setStatus((prev) => (prev === "success" ? prev : "loading"));
      // Refetches keep "success" so the last good list stays painted — the
      // refetching flag carries the thin head shimmer instead (§4).
      setRefetching(true);
      fetcher({ q: trimmed, city, filters, signal })
        .then((data) => {
          if (requestId.current !== id) return;
          setResponse(data);
          setStatus("success");
        })
        .catch((cause: unknown) => {
          if (requestId.current !== id || signal?.aborted) return;
          console.error("unified search failed", cause);
          setStatus("error");
        })
        .finally(() => {
          // Clear only when this request is still the latest — a superseded
          // request must not hide the newer one's shimmer.
          if (requestId.current === id) setRefetching(false);
        });
    },
    [city, fetcher, filters],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (!wantsResults) {
      requestId.current += 1;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => runSearch(trimmed, controller.signal), DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, city, filters, wantsResults, runSearch]);

  const retry = () => {
    // Re-run the request immediately instead of waiting on the debounce.
    if (wantsResults) runSearch(query.trim());
  };

  // DG56: Esc clears the query and dismisses suggestions.
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") handleQueryChange("");
  };

  const handleSelect = (item: SearchResultItem) => {
    addRecentSearch(item.name, city ?? response?.reference_point.city_id ?? "");
    onSelectResult(item);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {onCityChange && <CityScopeSelect city={city} onCityChange={onCityChange} />}
        <SearchField
          value={query}
          onChange={handleQueryChange}
          aria-label={t("title")}
          fullWidth
          className="min-w-0 flex-1"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder={t("search_hint")} onKeyDown={handleKeyDown} />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        {filterUi && (
          <FilterButton
            filters={filters}
            expanded={filterOpen}
            onPress={() => setFilterOpen((prev) => !prev)}
          />
        )}
      </div>

      {filterUi && <ActiveFilterChips filters={filters} onFiltersChange={onFiltersChange} />}

      {filterUi && (
        <FilterSurface
          isDesktop={isDesktop}
          open={filterOpen}
          onOpenChange={setFilterOpen}
          filters={filters}
          resultCount={response?.total_count ?? null}
          onFiltersChange={onFiltersChange}
        />
      )}

      {effectiveStatus === "idle" && !hideIdleHint && (
        <p className="px-3 py-2 text-sm text-muted">{t("search_hint")}</p>
      )}

      <div className={resultsClassName}>
        {effectiveStatus === "loading" && !response && <SearchSkeletons />}

        {/* DG141/§4: in-flight refetches keep the last good list — a thin
            shimmer at the list head, never skeletons over real content.
            Gated on effectiveStatus so a stale flag can't paint in idle
            (BRAWUKA-517). */}
        {refetching && response && effectiveStatus !== "idle" && (
          <div className="mx-3 h-0.5 w-16 animate-pulse rounded bg-surface-tertiary" aria-hidden />
        )}

        {effectiveStatus === "error" && (
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <p role="alert" className="text-sm text-muted">
              {t("could_not_search")}
            </p>
            <button
              type="button"
              onClick={retry}
              className="cm-focus -my-1.5 inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-accent transition-colors hover:bg-surface-secondary"
            >
              {t("retry")}
            </button>
          </div>
        )}

        {response && effectiveStatus !== "idle" && (
          <SearchResultsList
            response={response}
            externalSources={externalSources}
            mapkitConfigured={mapkitConfigured}
            onSelect={handleSelect}
            onExternalSearch={onExternalSearch}
            onRetry={retry}
            hasActiveFilters={filtersActive}
            onResetFilters={filterUi ? () => onFiltersChange(EMPTY_FILTERS) : undefined}
          />
        )}
      </div>
    </div>
  );
}
