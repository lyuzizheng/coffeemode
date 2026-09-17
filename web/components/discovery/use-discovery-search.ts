"use client";

/**
 * Search → selection/creation handoff (BRAWUKA-364). Owns the unified
 * search wiring shared by the desktop sidebar field and the mobile
 * capsule: a cafe result selects it (merged into the map dataset so the
 * camera can fly beyond the nearby list); a POI result — or an external
 * provider CTA — opens the creation sheet prefilled.
 */
import { useMemo, useState } from "react";
import { getSearchExternalSources } from "@/lib/client-env";
import type { ExternalSourceFlags } from "@/lib/client-env";
import type { SearchResultItem } from "@/lib/search/types";
import type { ExternalSearchProvider } from "@/components/search/search-results-list";
import type { POI } from "@shared/places/types";
import type { CafeSummary } from "@/types/cafes";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";

/** The search wiring handed to both surfaces (sidebar field, capsule). */
export interface DiscoverySearch {
  externalSources: ExternalSourceFlags;
  mapkitConfigured: boolean;
  city?: string;
  onSelectResult: (item: SearchResultItem) => void;
  onExternalSearch: (provider: ExternalSearchProvider) => void;
}

/** Draft handed to the creation sheet: a picked POI, or an empty open. */
export interface CreationDraft {
  poi: POI | null;
  /** External (google/apple) POIs persist through /api/places/external first. */
  persist: boolean;
}

export function useDiscoverySearch({
  controller,
  nearbyCafes,
  mapkitConfigured,
  city,
}: {
  controller: DiscoveryController;
  nearbyCafes: CafeSummary[];
  mapkitConfigured: boolean;
  city?: string;
}) {
  const [creationDraft, setCreationDraft] = useState<CreationDraft | null>(null);
  const [creationOpen, setCreationOpen] = useState(false);
  const [extraCafe, setExtraCafe] = useState<CafeSummary | null>(null);

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
      setCreationDraft({ poi: item.poi, persist: item.source !== "stored_poi" });
      setCreationOpen(true);
    }
  };

  // The creation sheet's own place search already carries the provider
  // tabs — the CTA opens it directly on the search step.
  const onExternalSearch = (_provider: ExternalSearchProvider) => {
    setCreationDraft({ poi: null, persist: false });
    setCreationOpen(true);
  };

  const search: DiscoverySearch = {
    externalSources: getSearchExternalSources(),
    mapkitConfigured,
    city,
    onSelectResult,
    onExternalSearch,
  };

  return { search, mapCafes, creationDraft, creationOpen, setCreationOpen };
}
