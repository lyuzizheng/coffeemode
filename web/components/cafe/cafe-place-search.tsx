"use client";

import {
  Button,
  Input,
  Label,
  SearchField,
  Spinner,
  TextField,
} from "@heroui/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiErrorMessage, apiFetch, isUnauthorized } from "@/lib/http";
import { getSearchExternalSources } from "@/lib/client-env";
import { readOnboardingState } from "@/lib/onboarding-store";
import { getPlaceSearchProviders } from "@/lib/places/providers";
import type { PlaceCandidate, PlaceSearchProvider } from "@/lib/places/place-search";
import {
  executeWidgetForToken,
  getTurnstileSiteKey,
  removeResolveWidget,
  renderInvisibleResolveWidget,
  resetResolveWidget,
} from "@/lib/security/turnstile-client";
import type { POI } from "@shared/places/types";
import type { ExternalSearchProvider } from "@/components/search/search-results-list";
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

export function CafePlaceSearch({ onSelectPOI, onError, onRequireSignIn, mapkitConfigured, initialProvider = null }: CafePlaceSearchProps) {
  const t = useTranslations("create");
  const providers = useMemo(
    () => getPlaceSearchProviders(t, { externalSources: getSearchExternalSources(), mapkitConfigured }),
    [t, mapkitConfigured],
  );
  const [provider, setProvider] = useState<PlaceSearchProvider | null>(
    () => providers.find((candidate) => candidate.id === initialProvider) ?? providers[0] ?? null,
  );
  const [entryMode, setEntryMode] = useState<EntryMode>(
    initialProvider && providers.length > 0 ? "search" : "link",
  );
  const [mapsUrl, setMapsUrl] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Provider init (script load / token fetch) runs on selection — a dead
  // session on the token fetch routes to the drawer's sign-in gate, every
  // other failure surfaces as the provider's unavailable error in the shared
  // alert slot.
  // Readiness is derived per provider id (state-during-render pattern), so
  // the effect only fires the async init, never sets state synchronously.
  const [readyProviderId, setReadyProviderId] = useState<string | null>(null);
  const providerReady = provider !== null && (!provider.init || readyProviderId === provider.id);
  useEffect(() => {
    if (!provider?.init) return;
    let cancelled = false;
    provider
      .init()
      .then(() => {
        if (!cancelled) setReadyProviderId(provider.id);
      })
      .catch((cause) => {
        if (cancelled) return;
        // A dead session on the token fetch is the same expired session the
        // Google search and persist paths route to the drawer's gate
        // (BRAWUKA-212): only signing in can clear it.
        if (isUnauthorized(cause)) {
          onRequireSignIn();
          return;
        }
        onError(t("searchFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [provider, onError, onRequireSignIn, t]);

  // Invisible Turnstile widget for the maps-link resolve (BRAWUKA-239):
  // rendered once while the link tab is active, executed per submit so
  // every POST carries a fresh single-use token; reset after each attempt
  // so retries mint a new one. Skipped when no sitekey is configured.
  useEffect(() => {
    if (entryMode !== "link") return;
    const sitekey = getTurnstileSiteKey();
    const container = turnstileRef.current;
    if (!sitekey || !container) return;
    let cancelled = false;
    let widgetId: string | null = null;
    renderInvisibleResolveWidget(container, sitekey)
      .then((id) => {
        if (cancelled) {
          removeResolveWidget(id);
          return;
        }
        widgetId = id;
        widgetIdRef.current = id;
        setTurnstileReady(true);
      })
      .catch(() => {
        if (!cancelled) onError(t("resolveFailed"));
      });
    return () => {
      cancelled = true;
      setTurnstileReady(false);
      widgetIdRef.current = null;
      if (widgetId) removeResolveWidget(widgetId);
    };
  }, [entryMode, onError, t]);

  const resolveLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!mapsUrl.trim()) return;
    const sitekey = getTurnstileSiteKey();
    const widgetId = widgetIdRef.current;
    let turnstileToken: string | null = null;
    if (sitekey) {
      if (!turnstileReady || !widgetId) {
        onError(t("resolveFailed"));
        return;
      }
      try {
        turnstileToken = await executeWidgetForToken(widgetId);
      } catch {
        onError(t("resolveFailed"));
        return;
      }
    }
    setBusy(true);
    onError(null);
    try {
      const resolvedPoi = await apiFetch<POI>("/api/places/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maps_share_url: mapsUrl.trim(),
          ...(turnstileToken ? { "cf-turnstile-response": turnstileToken } : {}),
        }),
      });
      onSelectPOI(resolvedPoi);
    } catch (cause) {
      onError(apiErrorMessage(cause, t("resolveFailed")));
    } finally {
      setBusy(false);
      if (sitekey && widgetId) {
        try {
          await resetResolveWidget(widgetId);
        } catch {
          // Benign: reset failure only affects the next retry token freshness.
        }
      }
    }
  };

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim() || !provider || !providerReady) return;
    setSearching(true);
    onError(null);
    try {
      // Bias live results toward the user's known center (BRAWUKA-280).
      const bias = readOnboardingState()?.lastLocation ?? null;
      setCandidates(await provider.search(query.trim(), bias ?? undefined));
    } catch (cause) {
      if (isUnauthorized(cause)) {
        onRequireSignIn();
        return;
      }
      onError(apiErrorMessage(cause, t("searchFailed")));
    } finally {
      setSearching(false);
    }
  };

  // Selection is the billed half of the two-phase search (BRAWUKA-602): the
  // provider turns the prediction into a full POI here, and only then does the
  // sheet move on to the form.
  const selectCandidate = async (candidate: PlaceCandidate) => {
    if (!provider || resolvingId !== null) return;
    setResolvingId(candidate.prediction.place_id);
    onError(null);
    try {
      const poi = await provider.resolve(candidate);
      setCandidates([]);
      onSelectPOI(poi, provider.persistOnSelect);
    } catch (cause) {
      if (isUnauthorized(cause)) {
        onRequireSignIn();
        return;
      }
      onError(apiErrorMessage(cause, t("searchFailed")));
    } finally {
      setResolvingId(null);
    }
  };

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

      {entryMode === "link" ? (
        <form className="space-y-3" onSubmit={resolveLink}>
          <p className="text-sm text-muted">{t("importHint")}</p>
          <div className="flex gap-2">
            <TextField className="min-w-0 flex-1">
              <Label className="sr-only">{t("mapsLink")}</Label>
              <Input
                value={mapsUrl}
                onChange={(event) => setMapsUrl(event.target.value)}
                placeholder={t("mapsLinkPlaceholder")}
                type="url"
              />
            </TextField>
            <Button type="submit" variant="secondary" isDisabled={busy || !mapsUrl.trim()}>
              {busy ? <Spinner size="sm" /> : t("resolveLink")}
            </Button>
          </div>
          {/* Invisible Turnstile challenge host for POST /api/places/resolve. */}
          <div ref={turnstileRef} aria-hidden="true" />
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2" role="group" aria-label={t("provider")}>
            {providers.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={provider?.id === candidate.id}
                onClick={() => {
                  setProvider(candidate);
                  setCandidates([]);
                  onError(null);
                }}
                className={`cm-focus flex h-9 items-center rounded-sm border px-3 text-xs font-medium ${
                  provider?.id === candidate.id
                    ? "border-secondary bg-secondary text-secondary-foreground"
                    : "border-border bg-surface-secondary text-foreground"
                }`}
              >
                {candidate.label}
              </button>
            ))}
          </div>
          {!providerReady ? (
            <p className="text-sm text-muted">{t("providerLoading")}</p>
          ) : (
            <form className="flex gap-2" onSubmit={runSearch}>
              <SearchField className="min-w-0 flex-1" value={query} onChange={setQuery}>
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder={t("searchPlaceholder")} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <Button type="submit" variant="secondary" isDisabled={searching || !query.trim()}>
                {searching ? <Spinner size="sm" /> : t("searchAction")}
              </Button>
            </form>
          )}
          {candidates.length > 0 ? (
            <div className="space-y-2" aria-label={t("searchResults")}>
              {candidates.map((candidate) => (
                <button
                  key={candidate.prediction.place_id}
                  type="button"
                  disabled={resolvingId !== null}
                  className="cm-focus flex w-full items-start justify-between gap-3 rounded-md border border-border bg-surface p-3 text-left hover:bg-surface-secondary disabled:opacity-60"
                  onClick={() => void selectCandidate(candidate)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {candidate.prediction.name}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted">
                      {candidate.prediction.address ?? t("noAddress")}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs uppercase text-muted">
                    {resolvingId === candidate.prediction.place_id ? (
                      <Spinner size="sm" />
                    ) : (
                      provider?.label
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
