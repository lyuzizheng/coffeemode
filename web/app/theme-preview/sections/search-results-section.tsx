"use client";

/**
 * Unified search results — DG131 grouped rendering, DG134/DG143 source-gated
 * CTAs, DG136 ranking preference (designed here first, per slice convention),
 * DG138 city-center distance label. Static fixture response; the live panel
 * (`UnifiedSearchPanel`) mounts on the search surfaces once map-home lands.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import { RankingPreferenceToggle } from "@/components/search/ranking-preference-toggle";
import { SearchResultsList } from "@/components/search/search-results-list";
import type { SearchResponse } from "@/lib/search/types";
import { Section } from "../shared";

const DEMO_RESPONSE: SearchResponse = {
  total_count: 2,
  is_weak_results: true,
  reference_point: { lat: 35.6812, lng: 139.7671, is_from_city_center: true },
  results: [
    {
      id: "demo-cafe-1",
      type: "cafe",
      source: "coffeemode",
      name: "Koffee Mameya",
      address: "Omotesando, Shibuya",
      lat: 35.6675,
      lng: 139.7118,
      distance_m: 6200,
      is_from_city_center: true,
    },
    {
      id: "demo-poi-1",
      type: "poi",
      source: "google",
      name: "Onibus Coffee",
      address: "Nakameguro, Meguro",
      lat: 35.6443,
      lng: 139.6991,
      distance_m: 7400,
      is_from_city_center: false,
    },
  ],
};

export function SearchResultsSection() {
  const t = useTranslations("themePreview.searchResults");
  const [lastAction, setLastAction] = useState<string | null>(null);

  return (
    <Section index="13" title={t("title")} desc={t("desc")}>
      <div className="flex max-w-md flex-col gap-6">
        <div className="rounded-lg border border-separator bg-surface p-4">
          <RankingPreferenceToggle variant="settings" />
        </div>

        <div className="rounded-lg border border-separator bg-surface p-4">
          <RankingPreferenceToggle variant="onboarding" />
        </div>

        <div className="rounded-lg border border-separator bg-surface py-2">
          <SearchResultsList
            response={DEMO_RESPONSE}
            externalSources={{ google: true, apple: true }}
            mapkitConfigured={false}
            onSelect={(item) => setLastAction(item.name)}
            onExternalSearch={(provider) => setLastAction(provider)}
          />
        </div>
        {lastAction && (
          <p className="text-xs text-muted">
            {t("last_action")}: <span className="tnum">{lastAction}</span>
          </p>
        )}
      </div>
    </Section>
  );
}
