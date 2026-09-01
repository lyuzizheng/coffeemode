"use client";

/**
 * Unified map-independent search panel (search-filters-v1 §3/§6/§7):
 * search-as-you-type from 3 characters with a 400ms debounce (DG44/DG47),
 * top-10 results rendered as DG131 groups via `SearchResultsList`, and
 * first-class states — hint before typing, 4-row skeleton on first load,
 * inline error + retry with the last good list preserved (DG141).
 *
 * It holds no map object and talks only to `GET /api/search`; plotting
 * results onto the map stays with map-discovery-integration.
 */
import { SearchField } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { addRecentSearch } from "@/lib/search/recent-searches";
import { fetchUnifiedSearch } from "@/lib/search/search-client";
import type { SearchResponse, SearchResultItem } from "@/lib/search/types";
import {
  SearchResultsList,
  type ExternalSearchProvider,
  type ExternalSourceFlags,
} from "./search-results-list";

const MIN_QUERY_LENGTH = 3; // DG44
const DEBOUNCE_MS = 400; // DG47

type SearchStatus = "idle" | "loading" | "success" | "error";

function SearchSkeletons() {
  return (
    <div className="flex flex-col gap-2 px-3 pt-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-1.5 py-1.5">
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface-tertiary" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-tertiary" />
        </div>
      ))}
    </div>
  );
}

export interface UnifiedSearchPanelProps {
  externalSources: ExternalSourceFlags;
  mapkitConfigured?: boolean;
  /** Effective city scope; omitted → server header/default resolution (DG128). */
  city?: string;
  onSelectResult: (item: SearchResultItem) => void;
  onExternalSearch: (provider: ExternalSearchProvider) => void;
}

export function UnifiedSearchPanel({
  externalSources,
  mapkitConfigured,
  city,
  onSelectResult,
  onExternalSearch,
}: UnifiedSearchPanelProps) {
  const t = useTranslations("search");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const requestId = useRef(0);

  // Below the 3-character trigger (DG44) the panel is idle by derivation —
  // no setState in the effect body. Stale in-flight requests are invalidated
  // via the request id.
  const isBelowMinQuery = query.trim().length < MIN_QUERY_LENGTH;
  const effectiveStatus: SearchStatus = isBelowMinQuery ? "idle" : status;

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestId.current += 1;
      return;
    }
    const id = ++requestId.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // Keep the last good list during refetch — never flash skeletons over
      // real content (DG141); skeletons are for the first load only.
      setStatus((prev) => (prev === "success" ? prev : "loading"));
      fetchUnifiedSearch({ q: trimmed, city, signal: controller.signal })
        .then((data) => {
          if (requestId.current !== id) return;
          setResponse(data);
          setStatus("success");
        })
        .catch((cause: unknown) => {
          if (requestId.current !== id || controller.signal.aborted) return;
          console.error("unified search failed", cause);
          setStatus("error");
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, city]);

  const retry = () => {
    // Re-run the effect chain immediately instead of waiting on the debounce.
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    const id = ++requestId.current;
    setStatus("loading");
    fetchUnifiedSearch({ q: trimmed, city })
      .then((data) => {
        if (requestId.current !== id) return;
        setResponse(data);
        setStatus("success");
      })
      .catch((cause: unknown) => {
        if (requestId.current !== id) return;
        console.error("unified search failed", cause);
        setStatus("error");
      });
  };

  // DG56: Esc clears the query and dismisses suggestions.
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") setQuery("");
  };

  const handleSelect = (item: SearchResultItem) => {
    addRecentSearch(item.name, city ?? response?.reference_point.city_id ?? "");
    onSelectResult(item);
  };

  return (
    <div className="flex flex-col gap-2">
      <SearchField value={query} onChange={setQuery} aria-label={t("title")}>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder={t("search_hint")} onKeyDown={handleKeyDown} />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      {effectiveStatus === "idle" && (
        <p className="px-3 py-2 text-sm text-muted">{t("search_hint")}</p>
      )}

      {effectiveStatus === "loading" && !response && <SearchSkeletons />}

      {effectiveStatus === "error" && (
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <p role="alert" className="text-sm text-muted">
            {t("could_not_search")}
          </p>
          <button
            type="button"
            onClick={retry}
            className="cm-focus rounded-md border border-border px-3 py-1.5 text-sm text-accent transition-colors hover:bg-surface-secondary"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {response && effectiveStatus !== "idle" && (
        <SearchResultsList
          response={response}
          externalSources={externalSources}
          mapkitConfigured={mapkitConfigured}
          onSelect={handleSelect}
          onExternalSearch={onExternalSearch}
        />
      )}
    </div>
  );
}
