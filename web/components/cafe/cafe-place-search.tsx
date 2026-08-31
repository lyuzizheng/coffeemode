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
import { useState, type FormEvent } from "react";
import { ApplePlaceSearch } from "@/components/cafe/apple-place-search";
import { responseMessage } from "@/lib/http";
import type { POI, POISearchResponse } from "@shared/places/types";

type EntryMode = "link" | "search";
type SearchProvider = "google" | "apple";

interface CafePlaceSearchProps {
  onSelectPOI: (poi: POI, persist?: boolean) => void;
  onError: (error: string | null) => void;
}

export function CafePlaceSearch({ onSelectPOI, onError }: CafePlaceSearchProps) {
  const t = useTranslations("create");
  const [entryMode, setEntryMode] = useState<EntryMode>("link");
  const [provider, setProvider] = useState<SearchProvider>("google");
  const [mapsUrl, setMapsUrl] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<POI[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  const resolveLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!mapsUrl.trim()) return;
    setBusy(true);
    onError(null);
    try {
      const response = await fetch("/api/places/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maps_share_url: mapsUrl.trim() }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, t("resolveFailed")));
      const resolvedPoi = (await response.json()) as POI;
      onSelectPOI(resolvedPoi);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t("resolveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const searchGoogle = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    onError(null);
    try {
      const response = await fetch(`/api/places/search?source=google&q=${encodeURIComponent(query.trim())}`);
      if (!response.ok) throw new Error(await responseMessage(response, t("searchFailed")));
      const data = (await response.json()) as POISearchResponse;
      setSearchResults(data.results);
    } catch (cause) {
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
