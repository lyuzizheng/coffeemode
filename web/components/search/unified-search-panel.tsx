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
import { SearchField } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSearchDebounceMs, getSearchMinQueryLength } from "@/lib/client-env";
import type { ExternalSourceFlags } from "@/lib/client-env";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { addRecentSearch } from "@/lib/search/recent-searches";
import { getRankingPreference } from "@/lib/search/ranking-preference";
import { fetchUnifiedSearch, resolveSearchScope, type UnifiedSearchParams } from "@/lib/search/search-client";
import { buildSearchHref } from "@/lib/search/search-url";
import {
  EMPTY_FILTERS,
  filtersToSearchParams,
  hasActiveFilters,
  type SearchFilterState,
} from "@/lib/search/search-filters";
import type { SearchResponse, SearchResultItem } from "@/lib/search/types";
import {
  ActiveFilterChips,
  CityScopeSelect,
  FilterButton,
} from "./search-filter-ui";
import { FilterSurface } from "./search-filter-surface";
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


/** Canonical signature of the request the panel would fire — the same
 * serialization `fetchUnifiedSearch` applies (`q` + resolved scope +
 * `filter_*`). Dedupe MUST compare this, not the query text alone: a
 * filter/city change with an unchanged query is a different request
 * (BRAWUKA-567). The scope goes through `resolveSearchScope` so the
 * signature matches the wire — a runtime city id signs as its `?lat&lng`
 * resolution, never `?city=` (BRAWUKA-568). */
function requestSignature(
  q: string,
  city: string | undefined,
  filters: SearchFilterState | undefined,
): string {
  const params = new URLSearchParams({ q });
  const scope = resolveSearchScope(city);
  if (scope.city) params.set("city", scope.city);
  if (typeof scope.lat === "number") params.set("lat", String(scope.lat));
  if (typeof scope.lng === "number") params.set("lng", String(scope.lng));
  if (filters) filtersToSearchParams(filters, params);
  return params.toString();
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
  const { isOffline } = useNetworkStatus();
  const [internalQuery, setInternalQuery] = useState("");
  const query = queryProp ?? internalQuery;
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [refetching, setRefetching] = useState(false);
  // DG46: Enter submits — the panel swaps compact suggestion rows for the
  // rich results view until the query is edited or Esc clears it.
  const [submitted, setSubmitted] = useState(false);
  const requestId = useRef(0);
  // Signature of the last request actually fired — lets Enter and the
  // debounce dedupe on the identical request instead of racing it.
  const fetchedSignatureRef = useRef<string | null>(null);
  // Controller of the pending/in-flight request — whoever fires owns it.
  const controllerRef = useRef<AbortController | null>(null);
  const fetcher = fetchSearch ?? fetchUnifiedSearch;
  const filterUi = filters !== undefined && onFiltersChange !== undefined;
  const filtersActive = filterUi && hasActiveFilters(filters);


  // BRAWUKA-364: the host mirrors the field value so it can swap its own
  // list for results while a query is active.
  const handleQueryChange = useCallback(
    (next: string) => {
      if (queryProp === undefined) setInternalQuery(next);
      setSubmitted(false);
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

  // BRAWUKA-716: When idle (no query, no active filters), clear stale response
  // and status so header resultCount vanishes and host index list takes over.
  if (!wantsResults && (response !== null || status !== "idle")) {
    setResponse(null);
    setStatus("idle");
  }

  // One runner for both the debounced effect, Enter and manual retry —
  // firing owns the controller so cancellation and dedup stay consistent.
  // Stale responses are discarded via the request id; a successful prior
  // status is kept during refetch so skeletons never flash over real
  // content (DG141).
  const runSearch = useCallback(
    (trimmed: string, force = false) => {
      const signature = requestSignature(trimmed, city, filters);
      // Identical request already pending/in-flight — adopt it. Enter must
      // never kill the only valid request (BRAWUKA-726) nor duplicate it.
      if (!force && signature === fetchedSignatureRef.current) return;
      // The previous request is stale the moment a new one fires.
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      fetchedSignatureRef.current = signature;
      const id = ++requestId.current;
      setStatus((prev) => (prev === "success" ? prev : "loading"));
      // Refetches keep "success" so the last good list stays painted — the
      // refetching flag carries the thin head shimmer instead (§4).
      setRefetching(true);
      fetcher({ q: trimmed, city, filters, signal: controller.signal })
        .then((data) => {
          if (requestId.current !== id) return;
          setResponse(data);
          setStatus("success");
        })
        .catch((cause: unknown) => {
          if (requestId.current !== id || controller.signal.aborted) return;
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
    // No valid request remains: cancel the in-flight fetch and reset the
    // signature so a later identical signature refetches instead of
    // deduping against a dead request.
    const cancelRequest = () => {
      requestId.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      fetchedSignatureRef.current = null;
    };
    if (!wantsResults) {
      cancelRequest();
      return;
    }
    // The identical request is already pending/in-flight (e.g. Enter fired
    // it) — dedupe instead of racing a duplicate.
    if (fetchedSignatureRef.current === requestSignature(trimmed, city, filters)) return;
    // Params changed: whatever is in flight is stale — cancel it now, not
    // only when the debounced replacement fires.
    cancelRequest();
    const timer = setTimeout(() => {
      // Orphaned timer (the dep change that cleared it raced a concurrent
      // fire): only fetch when this signature was never fetched.
      if (fetchedSignatureRef.current === requestSignature(trimmed, city, filters)) return;
      runSearch(trimmed);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, city, filters, wantsResults, runSearch]);

  // Unmount cancels whatever is pending — in-flight fetches resolve safely
  // into a discarded request id.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const retry = () => {
    // Re-run the request immediately instead of waiting on the debounce —
    // forced: retry must refire even an identical signature.
    if (wantsResults) runSearch(query.trim(), true);
  };
  // DG56: Enter submits the results view; Esc clears the query and
  // dismisses suggestions/results. When Esc actually consumed something it
  // preventDefaults so the detail column's window-level Esc handler leaves
  // the key alone (BRAWUKA-576); an already-empty field falls through and
  // Esc still closes the column.
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      if (query !== "" || submitted) event.preventDefault();
      handleQueryChange("");
      return;
    }
    if (event.key === "Enter") {
      const trimmed = query.trim();
      // Same trigger as the debounce path (DG44): Enter is a no-op only when
      // nothing would fetch — sub-min-length query AND no active filters.
      // Filter-active Enter submits the browse-mode results view (BRAWUKA-520).
      if (!wantsResults) return;
      setSubmitted(true);
      // runSearch dedups: an identical pending/in-flight request is
      // adopted, never aborted and never duplicated (BRAWUKA-726).
      runSearch(trimmed);
    }
  };

  const showResultsView = submitted && wantsResults;
  const viewAllHref = showResultsView
    ? buildSearchHref({
        q: query.trim(),
        // Same contract as the API (BRAWUKA-568): a runtime city id deep-links
        // by coordinates, never `?city=` — the SSR page would render
        // `unknown_city` for it.
        ...resolveSearchScope(city ?? response?.reference_point.city_id),
        ranking: getRankingPreference(),
        filters: filterUi ? filters : undefined,
      })
    : undefined;

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
            variant={showResultsView ? "results" : "suggestions"}
            viewAllHref={viewAllHref}
            onSelect={handleSelect}
            onExternalSearch={onExternalSearch}
            onRetry={retry}
            hasActiveFilters={filtersActive}
            onResetFilters={filterUi ? () => onFiltersChange(EMPTY_FILTERS) : undefined}
            isOffline={isOffline}
          />
        )}
      </div>
    </div>
  );
}
