"use client";

/**
 * Unified search result list (DG131) — renders the server-ordered
 * `SearchResponse` as two stable groups: CoffeeMode cafes first, then the
 * POI group (`stored_poi`/`google`/`apple`). Grouping is pure presentation
 * over `groupSearchResults`; intra-group order is exactly what the server
 * sent (relevance → distance → name → id, DG142) — no re-sorting here.
 *
 * Row language per search-filters-v1 §6: compact single-tap rows — name +
 * meta line. Distances are labeled `from city center` / `距市中心` when the
 * server anchored on the city center instead of the user (DG58/DG138).
 *
 * The external prompt (DG49) appears when local results are weak or empty;
 * its CTAs obey `app.yaml:search.externalSources` (DG134) and Apple stays
 * hidden until MapKit is configured (DG143).
 */
import { useTranslations } from "next-intl";
import { formatDistanceKm } from "@/lib/discovery/view-model";
import { groupSearchResults } from "@/lib/search/grouped-results";
import type { SearchResponse, SearchResultItem } from "@/lib/search/types";

export type ExternalSearchProvider = "google" | "apple";

export interface ExternalSourceFlags {
  google: boolean;
  apple: boolean;
}

interface SearchResultsListProps {
  response: SearchResponse;
  externalSources: ExternalSourceFlags;
  /** DG143 gate — defaults to the build-time NEXT_PUBLIC_MAPKIT_CONFIGURED flag. */
  mapkitConfigured?: boolean;
  onSelect: (item: SearchResultItem) => void;
  onExternalSearch: (provider: ExternalSearchProvider) => void;
  /** DG133 pairs the external-search notice with a retry action. */
  onRetry?: () => void;
}

function ResultRow({
  item,
  onSelect,
}: {
  item: SearchResultItem;
  onSelect: (item: SearchResultItem) => void;
}) {
  const t = useTranslations("search");
  const tDiscovery = useTranslations("discovery");

  const km = formatDistanceKm(item.distance_m);
  const meta = [
    item.type === "cafe" ? (item.cafe?.city ?? item.address) : item.address,
    km !== null ? tDiscovery("km_away", { km }) : null,
    // DG138: fallback-anchor distances must say so (距市中心).
    item.is_from_city_center && km !== null ? t("from_city_center") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="cm-focus flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-surface-secondary"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-display text-md font-bold text-foreground">
            {item.name}
          </span>
          {item.type === "poi" && (
            <span className="shrink-0 text-xs text-secondary">
              <span aria-hidden>+ </span>
              {t("not_on_coffeemode")}
            </span>
          )}
        </span>
        {meta && <span className="truncate text-xs text-muted">{meta}</span>}
      </button>
    </li>
  );
}

function GroupHeader({ label }: { label: string }) {
  return (
    <h3 className="px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-muted first:pt-0">
      {label}
    </h3>
  );
}

export function SearchResultsList({
  response,
  externalSources,
  mapkitConfigured = process.env.NEXT_PUBLIC_MAPKIT_CONFIGURED === "true",
  onSelect,
  onExternalSearch,
  onRetry,
}: SearchResultsListProps) {
  const t = useTranslations("search");
  const { coffeemode, external } = groupSearchResults(response.results);
  const isEmpty = response.results.length === 0;

  // DG134 + DG143: CTA visibility honors server config; Apple additionally
  // requires the MapKit gate.
  const showGoogleCta = externalSources.google;
  const showAppleCta = externalSources.apple && mapkitConfigured;
  const showExternalPrompt =
    (isEmpty || response.is_weak_results) && (showGoogleCta || showAppleCta);

  return (
    <div className="flex flex-col">
      {!isEmpty && (
        <div>
          {coffeemode.length > 0 && (
            <section aria-label={t("group_on_coffeemode")}>
              <GroupHeader label={t("group_on_coffeemode")} />
              <ul className="flex flex-col">
                {coffeemode.map((item) => (
                  <ResultRow key={item.id} item={item} onSelect={onSelect} />
                ))}
              </ul>
            </section>
          )}
          {external.length > 0 && (
            <section aria-label={t("group_more_places")}>
              <GroupHeader label={t("group_more_places")} />
              <ul className="flex flex-col">
                {external.map((item) => (
                  <ResultRow key={item.id} item={item} onSelect={onSelect} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {response.warnings?.includes("poi_unavailable") && (
        <div className="flex items-center justify-between gap-2 px-3 pt-2">
          <p role="status" className="text-xs text-muted">
            {t("external_unavailable")}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="cm-focus rounded-md border border-border px-2 py-1 text-xs text-accent transition-colors hover:bg-surface-secondary"
            >
              {t("retry")}
            </button>
          )}
        </div>
      )}

      {showExternalPrompt && (
        <div className="mt-2 flex flex-col gap-2 border-t border-separator px-3 pt-3">
          <p className="font-display text-md font-bold text-foreground">{t("not_finding")}</p>
          <div className="flex flex-wrap gap-2">
            {showGoogleCta && (
              <button
                type="button"
                onClick={() => onExternalSearch("google")}
                className="cm-focus rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-secondary"
              >
                {t("search_google_maps")}
              </button>
            )}
            {showAppleCta && (
              <button
                type="button"
                onClick={() => onExternalSearch("apple")}
                className="cm-focus rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-secondary"
              >
                {t("search_apple_maps")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
