"use client";

import { Button, SearchField, Spinner } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import type { POI } from "@shared/places/types";

const MAPKIT_SCRIPT = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";

interface MapKitPlace {
  id?: string;
  name?: string;
  formattedAddress?: string;
  coordinate?: { latitude: number; longitude: number };
  pointOfInterestCategory?: string;
}

interface MapKitApi {
  init(options: { authorizationCallback: (done: (token: string) => void) => void }): void;
  Search: new () => {
    search(
      query: string,
      callback: (error: unknown, response?: { places?: MapKitPlace[] }) => void,
    ): void;
  };
}

interface MapKitWindow extends Window {
  mapkit?: MapKitApi;
  __coffeeModeMapKitInitialized?: boolean;
}

function loadMapKitScript(): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${MAPKIT_SCRIPT}"]`);
  if (existing) {
    if (existing.dataset.loaded === "true") return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("MapKit script failed to load")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = MAPKIT_SCRIPT;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("MapKit script failed to load"));
    document.head.appendChild(script);
  });
}

async function fetchMapKitToken(): Promise<string> {
  const response = await fetch("/api/mapkit-token", { cache: "no-store" });
  if (!response.ok) throw new Error("MapKit is not configured");
  const { token } = (await response.json()) as { token?: string };
  if (!token) throw new Error("MapKit is not configured");
  return token;
}

// Fallback id for MapKit places without an `id`: FNV-1a over "lat,lng:name".
// 32-bit, so collisions and name/coordinate drift can split or merge distinct
// places — accepted for MVP. Must stay byte-identical to
// `stableApplePlaceId` in poi-service/src/handlers.ts or dedupe breaks.
function stablePlaceId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `apple:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function toPOI(place: MapKitPlace): POI | null {
  const name = place.name?.trim();
  const coordinate = place.coordinate;
  if (!name || !coordinate) return null;
  const placeId =
    place.id?.trim() || stablePlaceId(`${coordinate.latitude},${coordinate.longitude}:${name}`);
  return {
    place_id: placeId,
    source: "apple",
    name,
    lat: coordinate.latitude,
    lng: coordinate.longitude,
    address: place.formattedAddress ?? null,
    types: place.pointOfInterestCategory ? [place.pointOfInterestCategory] : [],
    business_status: null,
    hours_json: null,
    photo_refs: [],
    fetched_at: new Date().toISOString(),
  };
}

export function ApplePlaceSearch({ onSelect }: { onSelect: (poi: POI) => void }) {
  const t = useTranslations("create");
  const [mapKit, setMapKit] = useState<MapKitApi | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<POI[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      try {
        await fetchMapKitToken();
        await loadMapKitScript();
        const windowWithMapKit = window as MapKitWindow;
        const api = windowWithMapKit.mapkit;
        if (!api) throw new Error(t("appleUnavailable"));
        if (!windowWithMapKit.__coffeeModeMapKitInitialized) {
          api.init({
            authorizationCallback: (done) => {
              void fetchMapKitToken()
                .then(done)
                .catch(() => done(""));
            },
          });
          windowWithMapKit.__coffeeModeMapKitInitialized = true;
        }
        if (!cancelled) {
          setMapKit(api);
          setLoading(false);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : t("appleUnavailable"));
          setLoading(false);
        }
      }
    };
    void setup();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    if (!mapKit || !query.trim()) return;
    setSearching(true);
    setError(null);
    const request = new mapKit.Search();
    request.search(query.trim(), (searchError, response) => {
      if (searchError) {
        setError(t("searchFailed"));
        setSearching(false);
        return;
      }
      setResults((response?.places ?? []).map(toPOI).filter((poi): poi is POI => poi !== null));
      setSearching(false);
    });
  };

  return (
    <div className="space-y-3">
      {loading ? <p className="text-sm text-muted">{t("appleLoading")}</p> : null}
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
      {mapKit ? (
        <form className="flex gap-2" onSubmit={search}>
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
      ) : null}
      {results.length > 0 ? (
        <div className="space-y-2" aria-label={t("searchResults")}>
          {results.map((poi) => (
            <button
              key={poi.place_id}
              type="button"
              className="cm-focus flex w-full items-start justify-between gap-3 border border-border bg-surface p-3 text-left transition-colors hover:bg-surface-secondary"
              onClick={() => onSelect(poi)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{poi.name}</span>
                <span className="mt-1 block truncate text-xs text-muted">{poi.address ?? t("noAddress")}</span>
              </span>
              <span className="shrink-0 font-mono text-[0.65rem] uppercase text-muted">Apple</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
