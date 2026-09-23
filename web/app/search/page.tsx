import type { Metadata } from "next";
import { headers } from "next/headers";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { profileFromUser } from "@/lib/auth/profiles";
import { appConfig } from "@/lib/config";
import { resolveEffectiveCity } from "@/lib/cities";
import { logError } from "@/lib/observability/server-log";
import { getMapKitConfig } from "@/lib/places/mapkit";
import { fixtureSearchResponse, getSearchFixtures, isFixturesEnabled } from "@/lib/search/fixtures";
import {
  hasActiveFilterParams,
  parseSearchQuery,
  serializeSearchParams,
  validateSearchQuery,
} from "@/lib/search/search-params";
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
  // `parseSearchQuery` resolves a repeated param to its first value, matching
  // the API's `URLSearchParams.get` — pass the raw record through.
  const parsed = parseSearchQuery((name) => params[name]);
  const { filters } = parsed;

  // Shared rejection contract with `/api/search` (search-params.ts): invalid
  // lat/lng/limit or an unknown explicit city renders an error state instead
  // of silently searching — the page's mirror of the API's 400.
  const validation = validateSearchQuery(parsed);
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
  // DG140: fixtures short-circuit before validation, same as the API route —
  // a served fixture bypasses the rejection contract entirely.
  const fixtures =
    isFixturesEnabled() && params.fixtures === "1" ? getSearchFixtures() : null;
  const invalidParam = !fixtures && !validation.ok ? validation.error : null;
  if (fixtures) {
    response = fixtureSearchResponse(fixtures);
  } else if (invalidParam === null && hasInput) {
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

  const serialized = serializeSearchParams({ ...filters, city: effectiveCity });

  return (
    <SearchPageView
      q={filters.q ?? ""}
      effectiveCity={effectiveCity}
      filters={filters}
      params={serialized}
      response={response}
      failed={failed}
      invalidParam={invalidParam}
      externalSources={appConfig.search.externalSources}
      mapkitConfigured={getMapKitConfig() !== null}
      accountInitial={accountInitial}
    />
  );
}
