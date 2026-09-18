import type { Metadata } from "next";
import { headers } from "next/headers";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { profileFromUser } from "@/lib/auth/profiles";
import { appConfig } from "@/lib/config";
import { findCity, resolveEffectiveCity } from "@/lib/cities";
import { logError } from "@/lib/observability/server-log";
import { getMapKitConfig } from "@/lib/places/mapkit";
import { fixtureSearchResponse, getSearchFixtures, isFixturesEnabled } from "@/lib/search/fixtures";
import { hasActiveFilterParams, parseSearchQuery, serializeSearchParams } from "@/lib/search/search-params";
import { executeSearch } from "@/lib/search/search-service";
import type { SearchServiceResponse } from "@/lib/search/types";
import { SearchPageView } from "./search-page-view";

// SSR deep-link page (spec 0001 §Search + §SEO): `/search?q=&city=&filter_*`
// is the shareable form — rendered per request, noindex so it never competes
// with the canonical `/cafes/[id]` pages in search results.
export const dynamic = "force-dynamic";

// One Supabase getUser() per request, shared by metadata + body (DG13).
const loadViewer = cache(async () => {
  try {
    return await getCurrentUser();
  } catch {
    // Auth outage degrades to the anonymous view, never a 500.
    return null;
  }
});

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const t = await getTranslations("search");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  return {
    title: q ? `${q} — ${t("title")}` : t("title"),
    // Shareable but noindex (spec 0001 §SEO).
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { filters } = parseSearchQuery((name) => {
    const value = params[name];
    return typeof value === "string" ? value : null;
  });

  // DG128: an explicit city that matches no known city is an error state,
  // never a silent re-anchor (mirrors the API's 400).
  const cityKnown = filters.city === undefined || findCity(filters.city) !== null;
  const effectiveCity = resolveEffectiveCity(await headers(), filters.city);

  // The SSR page shares `/api/search` semantics by calling the service layer
  // directly — never a self-fetch. `include_live` stays off: live provider
  // fanout is a client-side CTA, not a first-paint cost (DG134).
  const viewer = await loadViewer();
  const accountInitial = viewer
    ? profileFromUser(viewer).displayName[0]?.toUpperCase()
    : undefined;
  let response: SearchServiceResponse | null = null;
  let failed = false;
  const hasInput = Boolean(filters.q) || hasActiveFilterParams(filters);
  if (cityKnown && hasInput) {
    if (isFixturesEnabled() && params.fixtures === "1") {
      const fixtures = getSearchFixtures();
      response = fixtures ? fixtureSearchResponse(fixtures) : null;
    } else {
      try {
        response = await executeSearch({
          ...filters,
          city: effectiveCity,
          include_live: false,
          viewer_id: viewer?.id,
        });
      } catch (err) {
        logError({ route: "GET /search", error: err, status: 500 });
        failed = true;
      }
    }
  }

  const serialized = serializeSearchParams({ ...filters, city: effectiveCity });

  return (
    <SearchPageView
      q={filters.q ?? ""}
      effectiveCity={effectiveCity}
      filters={filters}
      params={serialized}
      response={response}
      failed={failed}
      cityKnown={cityKnown}
      externalSources={appConfig.search.externalSources}
      mapkitConfigured={getMapKitConfig() !== null}
      accountInitial={accountInitial}
    />
  );
}
