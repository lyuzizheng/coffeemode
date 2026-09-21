"use client";

/**
 * Search → selection/creation handoff (BRAWUKA-364) + the search-state owner
 * (BRAWUKA-512, DG44–DG58). Owns the unified search wiring shared by the
 * desktop sidebar field and the mobile capsule: a cafe result selects it
 * (merged into the map dataset so the camera can fly beyond the nearby
 * list); a POI result — or an external provider CTA — opens the creation
 * sheet prefilled.
 *
 * State contract: `{query, city, filters}` is the single source of truth —
 * the Filter badge, removable chips, panel controls, emitted params, and
 * the `?`-synced URL all derive from it. Filter state is session-scoped
 * (DG51): it lives in React state + `history.replaceState` (DG48), so a
 * reload restores it and a closed tab clears it. The selected city persists
 * per the spec storage rules — onboarding localStorage for anonymous
 * visits, `profiles.current_city` for signed-in users (DG51/DG122).
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getSearchExternalSources } from "@/lib/client-env";
import type { ExternalSourceFlags } from "@/lib/client-env";
import { findCity } from "@/lib/cities";
import { readOnboardingState, subscribeOnboardingStore, writeOnboardingState } from "@/lib/onboarding-store";
import { persistProfile } from "@/lib/profile-merge";
import {
  EMPTY_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
  hasActiveFilters,
  type SearchFilterState,
} from "@/lib/search/search-filters";
import { setSearchUrlState } from "@/lib/search/search-url-state";
import type { SearchResultItem } from "@/lib/search/types";
import type { ExternalSearchProvider } from "@/components/search/search-results-list";
import type { POI, PlacePrediction } from "@shared/places/types";
import type { CafeSummary } from "@/types/cafes";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";

/** The search wiring handed to both surfaces (sidebar field, capsule). */
export interface DiscoverySearch {
  externalSources: ExternalSourceFlags;
  mapkitConfigured: boolean;
  /** Effective city scope — user pick > stored current city > prop (DG50). */
  city?: string;
  /** Controlled query — the host mirrors it for list-swapping. */
  query: string;
  onQueryChange: (query: string) => void;
  filters: SearchFilterState;
  onFiltersChange: (next: SearchFilterState) => void;
  onCityChange: (cityId: string) => void;
  /** True while the results surface should own the column (typing or
   * filters active) — hosts swap their own list for results. */
  searchActive: boolean;
  onSelectResult: (item: SearchResultItem) => void;
  onExternalSearch: (provider: ExternalSearchProvider) => void;
}

/** Draft handed to the creation sheet: a picked POI, a live prediction still
 *  awaiting its Place Details call, or an empty open. */
export interface CreationDraft {
  poi: POI | null;
  /** Apple POIs persist through /api/places/external first; Google POIs are stored server-side. */
  persist: boolean;
  /** Provider CTA the user tapped — the sheet opens on that provider's tab. */
  provider: ExternalSearchProvider | null;
  /** Live search result: the sheet resolves it into a POI on open (BRAWUKA-602). */
  prediction?: PlacePrediction;
  /** Autocomplete session the prediction was produced under. */
  session?: string;
}

/** `?q=&city=&filter_*=` deep-link state (DG48 restore). */
interface UrlSearchState {
  query: string;
  city: string | null;
  filters: SearchFilterState;
}

/** SSR/hydration snapshot — the server never sees the query string. */
const EMPTY_URL_STATE: UrlSearchState = { query: "", city: null, filters: EMPTY_FILTERS };
// Cached by the raw search string so getSnapshot returns a stable reference
// while the URL is unchanged — the deep link is read once, then the writer
// below keeps the history entry synced.
let urlSearchCacheKey: string | null = null;
let urlSearchStateCache: UrlSearchState = EMPTY_URL_STATE;

function readUrlSearchState(): UrlSearchState {
  if (typeof window === "undefined") return EMPTY_URL_STATE;
  const search = window.location.search;
  if (search !== urlSearchCacheKey) {
    const params = new URLSearchParams(search);
    const urlCity = params.get("city");
    urlSearchStateCache = {
      query: params.get("q") ?? "",
      // Unknown cities drop — the API would 400 on them anyway (DG128).
      city: urlCity ? (findCity(urlCity)?.id ?? null) : null,
      filters: filtersFromSearchParams(params),
    };
    urlSearchCacheKey = search;
  }
  return urlSearchStateCache;
}

const readUrlSearchStateServer = () => EMPTY_URL_STATE;
// Nothing outside this hook mutates `location.search` — no subscription.
const subscribeUrlSearchState = () => () => {};

const readStoredCity = () => readOnboardingState()?.currentCity ?? null;
const readStoredCityServer = () => null;

/** `{query, city, filters}` — the single source of truth behind the badge,
 * chips, panel, emitted params, and the `?`-synced URL (DG48/DG51). */
function useSearchState(cityProp: string | undefined, isAuthenticated: boolean) {
  // The deep link arrives through useSyncExternalStore (BRAWUKA-575): the
  // hydration render uses the server snapshot (EMPTY_URL_STATE) so the
  // first client frame matches SSR, then React's post-commit consistency
  // check re-reads the real URL state and re-renders synchronously.
  const urlState = useSyncExternalStore(
    subscribeUrlSearchState,
    readUrlSearchState,
    readUrlSearchStateServer,
  );
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilterState>(EMPTY_FILTERS);
  const [cityOverride, setCityOverride] = useState<string | null>(null);
  // Apply the deep link once, during render, the moment the client snapshot
  // replaces the server one — render-phase adjustment commits ahead of the
  // URL writer below, which stays gated until the restore lands.
  const [urlApplied, setUrlApplied] = useState(false);
  if (!urlApplied && urlState !== EMPTY_URL_STATE) {
    setUrlApplied(true);
    setQuery(urlState.query);
    setFilters(urlState.filters);
    setCityOverride(urlState.city);
  }
  // The stored current city (anonymous localStorage / mirrored profile) only
  // applies after mount — the server snapshot is null so hydration matches.
  // Subscribing keeps the scope live: onboarding's post-mount profile merge
  // and the locate flow both write through the store (P2, BRAWUKA-512).
  const storedCity = useSyncExternalStore(
    subscribeOnboardingStore,
    readStoredCity,
    readStoredCityServer,
  );


  const effectiveCity = cityOverride ?? storedCity ?? cityProp;

  // DG48: live changes replace the URL — shareable, no history spam. Writes
  // only happen on `/`; canonical `/cafes/[id]` URLs never carry params.
  useEffect(() => {
    if (!urlApplied) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (cityOverride) params.set("city", cityOverride);
    filtersToSearchParams(filters, params);
    const search = params.toString();
    setSearchUrlState(search ? `?${search}` : "");
    if (window.location.pathname === "/") {
      const next = search ? `/?${search}` : "/";
      if (`${window.location.pathname}${window.location.search}` !== next) {
        window.history.replaceState(null, "", next);
      }
    }
  }, [urlApplied, query, cityOverride, filters]);

  /** City is scope, not a filter (DG50): picking a city clears the query,
   * refetches, and persists per the storage rules (DG51). */
  const onCityChange = useCallback(
    (cityId: string) => {
      setCityOverride(cityId);
      setQuery("");
      writeOnboardingState({ currentCity: cityId, currentCityName: null });
      if (isAuthenticated) void persistProfile({ currentCity: cityId });
    },
    [isAuthenticated],
  );

  return {
    query,
    onQueryChange: setQuery,
    filters,
    onFiltersChange: setFilters,
    city: effectiveCity,
    onCityChange,
    searchActive: query.trim().length > 0 || hasActiveFilters(filters),
  };
}


export function useDiscoverySearch({
  controller,
  nearbyCafes,
  mapkitConfigured,
  city: cityProp,
  isAuthenticated = false,
  initialCreationOpen = false,
}: {
  controller: DiscoveryController;
  nearbyCafes: CafeSummary[];
  mapkitConfigured: boolean;
  /** Server-resolved city scope (DG128) — the fallback when the user has
   * never picked a city and storage holds none. */
  city?: string;
  /** Signed-in users persist city picks to `profiles.current_city` (DG51). */
  isAuthenticated?: boolean;
  /** ?create=1 deep link (BRAWUKA-504): the profile guide's "add a cafe"
   * step lands on the map with the creation sheet already open. */
  initialCreationOpen?: boolean;
}) {
  const [creationDraft, setCreationDraft] = useState<CreationDraft | null>(null);
  const [creationOpen, setCreationOpen] = useState(initialCreationOpen);
  const [extraCafe, setExtraCafe] = useState<CafeSummary | null>(null);
  const searchState = useSearchState(cityProp, isAuthenticated);

  const mapCafes = useMemo(() => {
    if (!extraCafe || nearbyCafes.some((c) => c.id === extraCafe.id)) return nearbyCafes;
    return [...nearbyCafes, extraCafe];
  }, [nearbyCafes, extraCafe]);

  const onSelectResult = (item: SearchResultItem) => {
    if (item.type === "cafe" && item.cafe) {
      setExtraCafe(item.cafe);
      controller.select(item.id);
      return;
    }
    if (item.poi) {
      setCreationDraft({ poi: item.poi, persist: item.source === "apple", provider: null });
      setCreationOpen(true);
      return;
    }
    // A live Autocomplete prediction has no POI yet. The Place Details call
    // that produces one is the billed half of the search (BRAWUKA-602), so it
    // runs inside the sheet — on this explicit selection, never while typing.
    if (item.prediction) {
      setCreationDraft({
        poi: null,
        persist: false,
        provider: null,
        prediction: item.prediction,
        session: item.prediction_session,
      });
      setCreationOpen(true);
    }
  };

  // The creation sheet's own place search carries the provider tabs — the CTA
  // opens it directly on the matching provider so the intent survives.
  const onExternalSearch = (provider: ExternalSearchProvider) => {
    setCreationDraft({ poi: null, persist: false, provider });
    setCreationOpen(true);
  };

  const search: DiscoverySearch = {
    externalSources: getSearchExternalSources(),
    mapkitConfigured,
    ...searchState,
    onSelectResult,
    onExternalSearch,
  };

  return { search, mapCafes, creationDraft, creationOpen, setCreationOpen };
}
