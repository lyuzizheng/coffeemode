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
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApplePlaceSearch } from "@/components/cafe/apple-place-search";
import { isUnauthorized, responseMessage, throwIfUnauthorized } from "@/lib/http";
import { readOnboardingState } from "@/lib/onboarding-store";
import {
  executeWidgetForToken,
  getTurnstileSiteKey,
  removeResolveWidget,
  renderInvisibleResolveWidget,
  resetResolveWidget,
} from "@/lib/security/turnstile-client";
import type { POI, POISearchResponse } from "@shared/places/types";
type EntryMode = "link" | "search";
type SearchProvider = "google" | "apple";

interface CafePlaceSearchProps {
  onSelectPOI: (poi: POI, persist?: boolean) => void;
  onError: (error: string | null) => void;
  /** `GET /api/places/search?source=google` is auth-gated; a 401 belongs to the
      drawer's sign-in gate, not to this component's alert slot. */
  onRequireSignIn: () => void;
}

export function CafePlaceSearch({ onSelectPOI, onError, onRequireSignIn }: CafePlaceSearchProps) {
  const t = useTranslations("create");
  const [entryMode, setEntryMode] = useState<EntryMode>("link");
  const [provider, setProvider] = useState<SearchProvider>("google");
  const [mapsUrl, setMapsUrl] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<POI[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

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
      const response = await fetch("/api/places/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maps_share_url: mapsUrl.trim(),
          ...(turnstileToken ? { "cf-turnstile-response": turnstileToken } : {}),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, t("resolveFailed")));
      const resolvedPoi = (await response.json()) as POI;
      onSelectPOI(resolvedPoi);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t("resolveFailed"));
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

  const searchGoogle = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    onError(null);
    try {
      // Bias live Google results toward the user's known center (BRAWUKA-280):
      // the worker sorts by distance only when lat/lng arrive.
      const stored = readOnboardingState()?.lastLocation ?? null;
      const params = new URLSearchParams({ source: "google", q: query.trim() });
      if (stored) {
        params.set("lat", String(stored.lat));
        params.set("lng", String(stored.lng));
      }
      const response = await fetch(`/api/places/search?${params}`);
      throwIfUnauthorized(response);
      if (!response.ok) throw new Error(await responseMessage(response, t("searchFailed")));
      const data = (await response.json()) as POISearchResponse;
      setSearchResults(data.results);
    } catch (cause) {
      if (isUnauthorized(cause)) {
        onRequireSignIn();
        return;
      }
      onError(cause instanceof Error ? cause.message : t("searchFailed"));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-1 border-b border-border" role="tablist" aria-label={t("entryMethods")}>
        {(["link", "search"] as const).map((mode) => (
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
            {(["google", "apple"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={provider === candidate}
                onClick={() => {
                  setProvider(candidate);
                  setSearchResults([]);
                  onError(null);
                }}
                className={`cm-focus rounded-sm border px-3 py-2 text-xs font-medium ${
                  provider === candidate
                    ? "border-secondary bg-secondary text-secondary-foreground"
                    : "border-border bg-surface-secondary text-foreground"
                }`}
              >
                {candidate === "google" ? t("google") : t("apple")}
              </button>
            ))}
          </div>
          {provider === "google" ? (
            <form className="flex gap-2" onSubmit={searchGoogle}>
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
          ) : (
            <ApplePlaceSearch
              onSelect={(selected) => {
                setSearchResults([]);
                onSelectPOI(selected, true);
              }}
            />
          )}
          {searchResults.length > 0 ? (
            <div className="space-y-2" aria-label={t("searchResults")}>
              {searchResults.map((result) => (
                <button
                  key={result.place_id}
                  type="button"
                  className="cm-focus flex w-full items-start justify-between gap-3 border border-border bg-surface p-3 text-left hover:bg-surface-secondary"
                  onClick={() => {
                    setSearchResults([]);
                    onSelectPOI(result);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{result.name}</span>
                    <span className="mt-1 block truncate text-xs text-muted">{result.address ?? t("noAddress")}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[0.65rem] uppercase text-muted">Google</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
