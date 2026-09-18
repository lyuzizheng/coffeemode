/**
 * Unified search result list (DG131) — renders the server-ordered
 * `SearchResponse` as two stable groups: CafeMood cafes first, then the
 * POI group (`stored_poi`/`google`/`apple`). Grouping is pure presentation
 * over `groupSearchResults`; intra-group order is exactly what the server
 * sent (relevance → distance → name → id, DG142) — no re-sorting here.
 *
 * Server-safe (no "use client"): the SSR `/search` page renders it with
 * `linkResults` (rows are real links, zero hydration) while the map panel
 * passes `onSelect` callbacks. Two row shapes per DG46: compact suggestion
 * rows while typing, rich rows (cover + facts) in the submitted results
 * view (`variant="results"`).
 *
 * Distances are labeled `from city center` / `距市中心` when the server
 * anchored on the city center instead of the user (DG58/DG138).
 *
 * The external prompt (DG49) appears when local results are weak or empty;
 * its CTAs obey `app.yaml:search.externalSources` (DG134) and Apple stays
 * hidden until MapKit is configured (DG143). On the SSR page the CTAs are
 * plain links to the provider's map search (`externalSearchLinks`); in the
 * map panel they open the creation sheet via `onExternalSearch`.
 */
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatDistanceKm } from "@/lib/discovery/view-model";
import { displayCityName } from "@/lib/cities";
import type { ExternalSourceFlags } from "@/lib/client-env";
import { PrivateBadge } from "@/components/cafe/private-badge";
import { groupSearchResults } from "@/lib/search/grouped-results";
import type { SearchResponse, SearchResultItem } from "@/lib/search/types";
import { SearchResultRichRow } from "./search-result-rich-row";

export type ExternalSearchProvider = "google" | "apple";

interface SearchResultsListProps {
  response: SearchResponse;
  externalSources: ExternalSourceFlags;
  /** DG143 gate — request-time MapKit readiness passed by the server page. */
  mapkitConfigured: boolean;
  /** DG46: `suggestions` = compact rows while typing; `results` = rich rows after submit. */
  variant?: "suggestions" | "results";
  /** SSR mode: rows render as links — cafes to `/cafes/[id]`, POIs to the provider's map. */
  linkResults?: boolean;
  /** SSR mode: external CTAs link to the provider's map search for this query. */
  externalSearchLinks?: { q: string };
  /** "View all results" affordance — the deep-linkable `/search` URL (DG48). */
  viewAllHref?: string;
  onSelect?: (item: SearchResultItem) => void;
  onExternalSearch?: (provider: ExternalSearchProvider) => void;
  /** DG133: `poi_unavailable` pairs the external-search notice with a retry action. */
  onRetry?: () => void;
  /** ≥1 nomad filter is on — the empty state becomes the filter-empty copy
   * with a Reset CTA (spec §7), not the generic empty state. */
  hasActiveFilters?: boolean;
  onResetFilters?: () => void;
  /** Offline disables the external CTAs (panel only — SSR omits it; the
   * hook lives behind "use client" so it can never run in this file). */
  isOffline?: boolean;
}

/** Row destination in link mode: canonical cafe page, or the provider's map for POIs. */
function resultItemHref(item: SearchResultItem): string | null {
  if (item.type === "cafe") return `/cafes/${item.id}`;
  if (!item.poi) return null;
  const q = encodeURIComponent(item.poi.name);
  return item.poi.source === "apple"
    ? `https://maps.apple.com/?q=${q}&ll=${item.poi.lat},${item.poi.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${item.poi.place_id}`;
}

/** Compact DG46 suggestion row — name + meta line, no cover (typing, not browsing). */
function ResultRow({
  item,
  href,
  onSelect,
}: {
  item: SearchResultItem;
  href: string | null;
  onSelect?: (item: SearchResultItem) => void;
}) {
  const t = useTranslations("search");
  const tDiscovery = useTranslations("discovery");
  const locale = useLocale();

  const km = formatDistanceKm(item.distance_m);
  const meta = [
    item.type === "cafe" ? (displayCityName(item.cafe?.city, locale) || item.address) : item.address,
    km !== null ? tDiscovery("km_away", { km }) : null,
    // DG138: fallback-anchor distances must say so (距市中心).
    item.is_from_city_center && km !== null ? t("from_city_center") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const inner = (
    <>
      <span className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-display text-md font-bold text-foreground">
            {item.name}
          </span>
          {/* DG147: private results only ever reach the owner (read-path filter). */}
          {item.cafe?.visibility === "private" && <PrivateBadge />}
        </span>
        {item.type === "poi" && (
          <span className="shrink-0 text-xs text-muted">
            <span aria-hidden>+ </span>
            {t("not_on_coffeemode")}
          </span>
        )}
      </span>
      {meta && <span className="tnum truncate text-xs text-muted">{meta}</span>}
    </>
  );

  const rowClass =
    "cm-focus flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-surface-secondary";

  if (href) {
    const external = href.startsWith("http");
    return (
      <li>
        {external ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={rowClass}>
            {inner}
          </a>
        ) : (
          <Link href={href} className={rowClass}>
            {inner}
          </Link>
        )}
      </li>
    );
  }

  return (
    <li>
      <button type="button" onClick={() => onSelect?.(item)} className={rowClass}>
        {inner}
      </button>
    </li>
  );
}

/** DG46 rich row — the parent wraps it in the surface's interactive element. */
function RichRow({
  item,
  href,
  onSelect,
}: {
  item: SearchResultItem;
  href: string | null;
  onSelect?: (item: SearchResultItem) => void;
}) {
  const rowClass =
    "cm-focus block w-full rounded-md text-left transition-colors hover:bg-surface-secondary";
  if (href) {
    const external = href.startsWith("http");
    return (
      <li>
        {external ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={rowClass}>
            <SearchResultRichRow item={item} />
          </a>
        ) : (
          <Link href={href} className={rowClass}>
            <SearchResultRichRow item={item} />
          </Link>
        )}
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={() => onSelect?.(item)} className={rowClass}>
        <SearchResultRichRow item={item} />
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

/** DG49 external-search prompt — provider CTAs as links (SSR) or callbacks (panel). */
function ExternalPrompt({
  showGoogle,
  showApple,
  links,
  isOffline,
  onExternalSearch,
}: {
  showGoogle: boolean;
  showApple: boolean;
  links?: { q: string };
  isOffline: boolean;
  onExternalSearch?: (provider: ExternalSearchProvider) => void;
}) {
  const t = useTranslations("search");
  const ctaClass =
    "cm-focus -my-1 inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:bg-surface-secondary";
  const googleHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(links?.q ?? "")}`;
  const appleHref = `https://maps.apple.com/?q=${encodeURIComponent(links?.q ?? "")}`;

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-separator px-3 pt-3">
      <p className="font-display text-md font-bold text-foreground">{t("not_finding")}</p>
      <div className="flex flex-wrap gap-2">
        {showGoogle &&
          (links ? (
            <a href={googleHref} target="_blank" rel="noopener noreferrer" className={ctaClass}>
              {t("search_google_maps")}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => onExternalSearch?.("google")}
              disabled={isOffline}
              className={`${ctaClass} disabled:opacity-50 disabled:hover:bg-transparent`}
            >
              {t("search_google_maps")}
            </button>
          ))}
        {showApple &&
          (links ? (
            <a href={appleHref} target="_blank" rel="noopener noreferrer" className={ctaClass}>
              {t("search_apple_maps")}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => onExternalSearch?.("apple")}
              disabled={isOffline}
              className={`${ctaClass} disabled:opacity-50 disabled:hover:bg-transparent`}
            >
              {t("search_apple_maps")}
            </button>
          ))}
      </div>
    </div>
  );
}

export function SearchResultsList({
  response,
  externalSources,
  mapkitConfigured,
  variant = "suggestions",
  linkResults = false,
  externalSearchLinks,
  viewAllHref,
  onSelect,
  onExternalSearch,
  onRetry,
  hasActiveFilters = false,
  onResetFilters,
  isOffline = false,
}: SearchResultsListProps) {
  const t = useTranslations("search");
  const { coffeemode, external } = groupSearchResults(response.results);
  const isEmpty = response.results.length === 0;
  const rich = variant === "results";


  // DG134 + DG143: CTA visibility honors server config; Apple additionally
  // requires the MapKit gate.
  const showGoogleCta = externalSources.google;
  const showAppleCta = externalSources.apple && mapkitConfigured;
  const showExternalPrompt =
    (isEmpty || response.is_weak_results) && (showGoogleCta || showAppleCta);

  const renderRow = (item: SearchResultItem) => {
    const href = linkResults ? resultItemHref(item) : null;
    return rich ? (
      <RichRow key={item.id} item={item} href={href} onSelect={onSelect} />
    ) : (
      <ResultRow key={item.id} item={item} href={href} onSelect={onSelect} />
    );
  };

  return (
    <div className="flex flex-col">
      {/* Spec §7: empty under active filters gets its own copy + Reset CTA —
          never the generic empty state; the §6 external footer still
          follows as the designed overflow path. */}
      {isEmpty && hasActiveFilters && (
        <div className="flex flex-col items-start gap-1 px-3 py-3">
          <p className="font-display text-md font-bold text-foreground">
            {t("no_match_filters")}
          </p>
          <p className="text-sm text-muted">{t("loosen_filters")}</p>
          {onResetFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="cm-focus -my-1 inline-flex min-h-11 items-center text-sm text-accent transition-colors hover:underline"
            >
              {t("reset_filters")}
            </button>
          )}
        </div>
      )}

      {!isEmpty && (
        <div>
          {coffeemode.length > 0 && (
            <section aria-label={t("group_on_coffeemode")}>
              <GroupHeader label={t("group_on_coffeemode")} />
              <ul className="flex flex-col">{coffeemode.map(renderRow)}</ul>
            </section>
          )}
          {external.length > 0 && (
            <section aria-label={t("group_more_places")}>
              <GroupHeader label={t("group_more_places")} />
              <ul className="flex flex-col">{external.map(renderRow)}</ul>
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
              className="cm-focus -my-2 inline-flex min-h-11 items-center rounded-md border border-border px-2 text-xs text-accent transition-colors hover:bg-surface-secondary"
            >
              {t("retry")}
            </button>
          )}
        </div>
      )}
      {viewAllHref && (
        <div className="px-3 pt-2">
          <Link
            href={viewAllHref}
            className="cm-focus -mx-1 inline-flex min-h-11 items-center rounded-md px-2 text-sm text-accent transition-colors hover:bg-surface-secondary"
          >
            {t("view_all_results")}
          </Link>
        </div>
      )}

      {showExternalPrompt && (
        <ExternalPrompt
          showGoogle={showGoogleCta}
          showApple={showAppleCta}
          links={externalSearchLinks}
          isOffline={isOffline}
          onExternalSearch={onExternalSearch}
        />
      )}
    </div>
  );
}
