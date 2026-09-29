"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { getSearchExternalSources } from "@/lib/client-env";
import { getPlaceSearchProviders } from "@/lib/places/providers";
import type { POI } from "@shared/places/types";
import type { ExternalSearchProvider } from "@/components/search/search-results-list";
import { MapsLinkResolveForm } from "./maps-link-resolve-form";
import { ProviderPlaceSearch } from "./provider-place-search";

type EntryMode = "link" | "search";

interface CafePlaceSearchProps {
  onSelectPOI: (poi: POI, persist?: boolean) => void;
  onError: (error: string | null) => void;
  /** `GET /api/places/autocomplete` and `GET /api/places/details` are
      auth-gated; a 401 belongs to the drawer's sign-in gate, not to this
      component's alert slot. */
  onRequireSignIn: () => void;
  /** DG143 request-time MapKit readiness, drilled from the server page. */
  mapkitConfigured: boolean;
  /** BRAWUKA-366: provider CTA tapped upstream — preselects that provider's
   * chip and the search tab so the intent survives the sheet open. */
  initialProvider?: ExternalSearchProvider | null;
}

/**
 * Coordinator for the two place-entry workflows. The maps-link form and the
 * provider search/details form carry different lifetimes — one Turnstile
 * widget per link-tab activation vs. a provider init that runs once on sheet
 * open — so they live in sibling components kept mounted and hidden per
 * `active`: tab switches preserve draft URL, query, provider selection and
 * candidate results without changing init timing.
 */
export function CafePlaceSearch({ onSelectPOI, onError, onRequireSignIn, mapkitConfigured, initialProvider = null }: CafePlaceSearchProps) {
  const t = useTranslations("create");
  const providers = useMemo(
    () => getPlaceSearchProviders(t, { externalSources: getSearchExternalSources(), mapkitConfigured }),
    [t, mapkitConfigured],
  );
  const [entryMode, setEntryMode] = useState<EntryMode>(
    initialProvider && providers.length > 0 ? "search" : "link",
  );

  // DG134: with every external source off the registry is empty — the search
  // tab would have no provider to offer, so only link import remains.
  const entryModes = providers.length > 0 ? (["link", "search"] as const) : (["link"] as const);

  return (
    <div className="space-y-5">
      <div
        className={`grid gap-1 border-b border-separator ${entryModes.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}
        role="tablist"
        aria-label={t("entryMethods")}
      >
        {entryModes.map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={entryMode === mode}
            onClick={() => {
              setEntryMode(mode);
              onError(null);
            }}
            className={`cm-focus border-b-2 px-3 py-3 text-sm font-medium ${
              entryMode === mode ? "border-accent text-foreground" : "border-transparent text-muted"
            }`}
          >
            {mode === "link" ? t("importLink") : t("searchPlace")}
          </button>
        ))}
      </div>

      <MapsLinkResolveForm active={entryMode === "link"} onSelectPOI={onSelectPOI} onError={onError} />
      <ProviderPlaceSearch
        active={entryMode === "search"}
        providers={providers}
        initialProvider={initialProvider}
        onSelectPOI={onSelectPOI}
        onError={onError}
        onRequireSignIn={onRequireSignIn}
      />
    </div>
  );
}
