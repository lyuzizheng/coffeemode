/**
 * SSR `/search` view — server-safe presentational component (no "use
 * client"): the whole page renders without hydration. The GET form keeps
 * `q`/`city` editable and carries active `filter_*` params as hidden
 * fields, so a resubmitted query stays inside the shared deep-link
 * contract (`lib/search/search-params.ts`, DG48).
 *
 * Filter controls degrade to removable chips (DG54) until the
 * filter-surface slice lands — the URL contract is already honored
 * server-side; only the editing UI is deferred.
 */
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { SearchResultsList } from "@/components/search/search-results-list";
import { SiteMasthead } from "@/components/site-masthead";
import { LAUNCH_CITIES, displayCityName } from "@/lib/cities";
import type { ExternalSourceFlags } from "@/lib/client-env";
import { WORK_DIM_FILTER_MAP } from "@/lib/search/filter";
import type { SearchFilters, SearchParamError, SearchServiceResponse } from "@/lib/search/types";
import type { WorkDim } from "@/lib/stats/work-stats";
import type { MaxStay } from "@/types/checkins";

interface ActiveFilter {
  key: string;
  label: string;
  removeHref: string;
}

/** Removable chips for active filters (DG54) — labels resolved by the caller
 *  so next-intl's typed keys stay at the call site. */
function activeFilterChips({
  filters,
  params,
  labels,
}: {
  filters: SearchFilters;
  params: URLSearchParams;
  labels: {
    openNow: string;
    dim: (dim: WorkDim) => string;
    maxStay: (value: MaxStay) => string;
  };
}): ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  const removeHrefFor = (key: string) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    const qs = next.toString();
    return qs ? `/search?${qs}` : "/search";
  };

  if (filters.open_now === true) {
    chips.push({ key: "open_now", label: labels.openNow, removeHref: removeHrefFor("open_now") });
  }
  for (const { key, dim } of WORK_DIM_FILTER_MAP) {
    const val = filters[key];
    if (val !== undefined) {
      chips.push({
        key,
        label: `${labels.dim(dim)} ${val}+`,
        removeHref: removeHrefFor(key),
      });
    }
  }
  if (filters.filter_max_stay) {
    chips.push({
      key: "filter_max_stay",
      label: labels.maxStay(filters.filter_max_stay),
      removeHref: removeHrefFor("filter_max_stay"),
    });
  }
  return chips;
}

/** Server-rendered GET form: search field + city scope + submit. */
function SearchForm({
  q,
  effectiveCity,
  hidden,
}: {
  q: string;
  effectiveCity: string;
  hidden: Array<[string, string]>;
}) {
  const t = useTranslations("search");
  const locale = useLocale();
  return (
    <form action="/search" method="get" role="search" className="flex items-center gap-2">
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder={t("search_hint")}
        aria-label={t("title")}
        className="cm-focus min-h-11 min-w-0 flex-1 rounded-md border border-separator bg-surface px-3 text-sm text-foreground placeholder:text-muted"
      />
      <select
        name="city"
        defaultValue={effectiveCity}
        aria-label={t("city")}
        className="cm-focus min-h-11 shrink-0 rounded-md border border-separator bg-surface px-2 text-sm text-foreground"
      >
        {LAUNCH_CITIES.map((city) => (
          <option key={city.id} value={city.id}>
            {displayCityName(city.id, locale)}
          </option>
        ))}
      </select>
      {hidden.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        className="cm-focus min-h-11 shrink-0 rounded-md border border-separator bg-surface-secondary px-3 text-sm text-foreground transition-colors hover:bg-surface-tertiary"
      >
        {t("title")}
      </button>
    </form>
  );
}

/** Body states: invalid params, fetch failure, idle hint, or the results list. */
function ResultsSection({
  invalidParam,
  failed,
  hasInput,
  response,
  hasActiveFilters,
  currentHref,
  externalQuery,
  externalSources,
  mapkitConfigured,
}: {
  invalidParam: SearchParamError | null;
  failed: boolean;
  hasInput: boolean;
  response: SearchServiceResponse | null;
  hasActiveFilters: boolean;
  currentHref: string;
  externalQuery: string;
  externalSources: ExternalSourceFlags;
  mapkitConfigured: boolean;
}) {
  const t = useTranslations("search");

  // Mirrors the API's 400: a rejected deep link gets an error state, never a
  // silently re-anchored or mis-sorted result list.
  if (invalidParam !== null) {
    return (
      <p role="alert" className="text-sm text-muted">
        {invalidParam === "city" ? t("unknown_city") : t("invalid_params")}
      </p>
    );
  }
  if (failed) {
    return (
      <div className="flex items-center justify-between gap-2 py-2">
        <p role="alert" className="text-sm text-muted">
          {t("could_not_search")}
        </p>
        <Link
          href={currentHref}
          className="cm-focus -my-1.5 inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-accent transition-colors hover:bg-surface-secondary"
        >
          {t("retry")}
        </Link>
      </div>
    );
  }
  if (!hasInput) {
    return <p className="py-2 text-sm text-muted">{t("search_hint")}</p>;
  }
  if (!response) return null;

  return (
    <>
      {response.results.length > 0 && (
        <p className="tnum text-sm text-muted">
          {t("result_count", { count: response.total_count })}
        </p>
      )}
      {response.results.length === 0 && hasActiveFilters && (
        <div className="flex flex-col gap-1 py-2">
          <p className="font-display text-md font-bold text-foreground">
            {t("no_match_filters")}
          </p>
          <p className="text-sm text-muted">{t("loosen_filters")}</p>
        </div>
      )}
      <SearchResultsList
        response={response}
        externalSources={externalSources}
        mapkitConfigured={mapkitConfigured}
        variant="results"
        linkResults
        externalSearchLinks={{ q: externalQuery }}
      />
    </>
  );
}

/** DG54 removable-filter chips — one row, each chip a link that drops its param. */
function FilterChipRow({ chips }: { chips: ActiveFilter[] }) {
  const t = useTranslations("search");
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t("filters")}>
      {chips.map((chip) => (
        <li key={chip.key}>
          <Link
            href={chip.removeHref}
            aria-label={t("remove_filter", { label: chip.label })}
            className="cm-focus inline-flex min-h-8 items-center gap-1.5 rounded-sm bg-surface-secondary px-2.5 text-xs text-foreground transition-colors hover:bg-surface-tertiary"
          >
            {chip.label}
            <span aria-hidden>✕</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SearchPageView({
  q,
  effectiveCity,
  filters,
  params,
  response,
  failed,
  invalidParam,
  externalSources,
  mapkitConfigured,
  accountInitial,
}: {
  q: string;
  effectiveCity: string;
  filters: SearchFilters;
  /** Serialized current params — chip-remove hrefs and hidden form fields derive from it. */
  params: URLSearchParams;
  response: SearchServiceResponse | null;
  failed: boolean;
  invalidParam: SearchParamError | null;
  externalSources: ExternalSourceFlags;
  mapkitConfigured: boolean;
  accountInitial?: string;
}) {
  const t = useTranslations("search");
  const tDiscovery = useTranslations("discovery");
  const locale = useLocale();

  const chips = activeFilterChips({
    filters,
    params,
    labels: {
      openNow: t("openNow"),
      dim: (dim) => tDiscovery(`dims.${dim}`),
      maxStay: (value) => `${t("maxStay")} · ${t(`maxStayOptions.${value}`)}`,
    },
  });
  const hasInput = Boolean(q) || chips.length > 0;
  const hidden = [...params.entries()].filter(([name]) => name !== "q" && name !== "city");
  const currentHref = `/search?${params.toString()}`;
  const cityName = displayCityName(effectiveCity, locale);
  const externalQuery = q || t("external_fallback_query", { city: cityName });

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteMasthead accountInitial={accountInitial} />
      <main className="mx-auto flex w-full max-w-[var(--layout-content-max)] flex-1 flex-col gap-4 px-4 pb-12 pt-5 sm:px-6">
        <SearchForm q={q} effectiveCity={effectiveCity} hidden={hidden} />

        <FilterChipRow chips={chips} />

        <ResultsSection
          invalidParam={invalidParam}
          failed={failed}
          hasInput={hasInput}
          response={response}
          hasActiveFilters={chips.length > 0}
          currentHref={currentHref}
          externalQuery={externalQuery}
          externalSources={externalSources}
          mapkitConfigured={mapkitConfigured}
        />
      </main>
    </div>
  );
}
