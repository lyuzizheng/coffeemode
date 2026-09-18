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
import { readOnboardingState, writeOnboardingState } from "@/lib/onboarding-store";
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
import type { POI } from "@shared/places/types";
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

/** Draft handed to the creation sheet: a picked POI, or an empty open. */
export interface CreationDraft {
  poi: POI | null;
  /** Apple POIs persist through /api/places/external first; Google POIs are stored server-side. */
  persist: boolean;
  /** Provider CTA the user tapped — the sheet opens on that provider's tab. */
  provider: ExternalSearchProvider | null;
}

/** Read the `?q=&city=&filter_*=` deep-link state once (DG48 restore). */
function readUrlSearchState(): { query: string; city: string | null; filters: SearchFilterState } {
  if (typeof window === "undefined") {
    return { query: "", city: null, filters: EMPTY_FILTERS };
  }
  const params = new URLSearchParams(window.location.search);
  const urlCity = params.get("city");
  return {
    query: params.get("q") ?? "",
    // Unknown cities drop — the API would 400 on them anyway (DG128).
    city: urlCity ? (findCity(urlCity)?.id ?? null) : null,
    filters: filtersFromSearchParams(params),
  };
}

const noopSubscribe = () => () => {};
const readStoredCity = () => readOnboardingState()?.currentCity ?? null;
const readStoredCityServer = () => null;

/** `{query, city, filters}` — the single source of truth behind the badge,
 * chips, panel, emitted params, and the `?`-synced URL (DG48/DG51). */
function useSearchState(cityProp: string | undefined, isAuthenticated: boolean) {
  // Lazy init reads the deep link once; the URL is the session store.
  const [urlState] = useState(readUrlSearchState);
  const [query, setQuery] = useState(urlState.query);
  const [filters, setFilters] = useState<SearchFilterState>(urlState.filters);
  const [cityOverride, setCityOverride] = useState<string | null>(urlState.city);
  // The stored current city (anonymous localStorage / mirrored profile) only
  // applies after mount — the server snapshot is null so hydration matches.
  const storedCity = useSyncExternalStore(
    noopSubscribe,
    readStoredCity,
    readStoredCityServer,
  );

  const effectiveCity = cityOverride ?? storedCity ?? cityProp;

  // DG48: live changes replace the URL — shareable, no history spam. Writes
  // only happen on `/`; canonical `/cafes/[id]` URLs never carry params.
  useEffect(() => {
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
  }, [query, cityOverride, filters]);

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
