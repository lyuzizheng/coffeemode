import { isUnauthorized, throwIfUnauthorized, UNAUTHORIZED } from "@/lib/http";
import type { POI } from "@shared/places/types";
import { stableApplePlaceId } from "@shared/places/apple-place-id";
import type { CreateTranslator, PlaceSearchProvider } from "./place-search";

/**
 * Apple place search via MapKit JS (client-side SDK — Apple's web search API
 * is the JS SDK, not a REST endpoint). Results are client-side POIs, so
 * `persistOnSelect` marks them for the server store on selection.
 */
const MAPKIT_SCRIPT = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";

interface MapKitPlace {
  id?: string;
  name?: string;
  formattedAddress?: string;
  coordinate?: { latitude: number; longitude: number };
  pointOfInterestCategory?: string;
}

interface MapKitSearch {
  search(
    query: string,
    callback: (error: unknown, response?: { places?: MapKitPlace[] }) => void,
  ): void;
}

interface MapKitApi {
  init(options: { authorizationCallback: (done: (token: string) => void) => void }): void;
  Search: new () => MapKitSearch;
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
  throwIfUnauthorized(response);
  if (!response.ok) throw new Error("MapKit is not configured");
  const { token } = (await response.json()) as { token?: string };
  if (!token) throw new Error("MapKit is not configured");
  return token;
}

/**
 * MapKit JS owns its own auth lifecycle: once `mapkit.init` runs, the SDK may
 * invoke `authorizationCallback` again at any time (expired JWT, 401 from
 * Apple) with no promise for the app to await. A 401 on that re-auth means
 * OUR session died — the drawer's sign-in gate (BRAWUKA-212) is the only
 * surface that can clear it — but the callback cannot throw at MapKit, so the
 * marker is latched here and replayed through `search()` rejections, which the
 * drawer already routes to the gate. Module scope mirrors `mapkit.init`'s
 * once-per-page global state.
 */
let mapKitSessionExpired = false;

/** Searches blocked on a MapKit authorization round-trip; drained on a 401. */
const pendingSearches = new Set<() => void>();

async function fetchMapKitTokenTracked(): Promise<string> {
  try {
    const token = await fetchMapKitToken();
    mapKitSessionExpired = false;
    return token;
  } catch (cause) {
    mapKitSessionExpired = isUnauthorized(cause);
    if (mapKitSessionExpired) {
      // Fail in-flight searches now: MapKit may never call their callbacks
      // after a failed authorization, and a hanging spinner must not be the
      // session-expired signal.
      for (const fail of pendingSearches) fail();
    }
    throw cause;
  }
}

function toPOI(place: MapKitPlace): POI | null {
  const name = place.name?.trim();
  const coordinate = place.coordinate;
  if (!name || !coordinate) return null;
  const placeId =
    place.id?.trim() || stableApplePlaceId(`${coordinate.latitude},${coordinate.longitude}:${name}`);
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
    fetched_at: new Date().toISOString(),
  };
}

export function applePlaceSearch(t: CreateTranslator): PlaceSearchProvider {
  let api: MapKitApi | null = null;
  return {
    id: "apple",
    label: t("apple"),
    persistOnSelect: true,
    async init() {
      await fetchMapKitTokenTracked();
      await loadMapKitScript();
      const windowWithMapKit = window as MapKitWindow;
      const mapkit = windowWithMapKit.mapkit;
      if (!mapkit) throw new Error(t("appleUnavailable"));
      if (!windowWithMapKit.__coffeeModeMapKitInitialized) {
        mapkit.init({
          authorizationCallback: (done) => {
            void fetchMapKitTokenTracked()
              .then(done)
              // MapKit tolerates only `done("")` on failure; the 401 case is
              // already latched by the tracked fetch and surfaces via search().
              .catch(() => done(""));
          },
        });
        windowWithMapKit.__coffeeModeMapKitInitialized = true;
      }
      api = mapkit;
    },
    async search(query) {
      if (!api) throw new Error(t("appleUnavailable"));
      // A re-auth 401 latched between init and now is the same dead session the
      // token fetch reports — route it to the sign-in gate, not the alert slot.
      if (mapKitSessionExpired) throw new Error(UNAUTHORIZED);
      const request = new api.Search();
      const { promise, resolve, reject } = Promise.withResolvers<POI[]>();
      const fail = () => {
        pendingSearches.delete(fail);
        reject(new Error(UNAUTHORIZED));
      };
      pendingSearches.add(fail);
      request.search(query, (searchError, response) => {
        pendingSearches.delete(fail);
        if (searchError) {
          reject(new Error(t("searchFailed")));
          return;
        }
        resolve(
          (response?.places ?? []).map(toPOI).filter((poi): poi is POI => poi !== null),
        );
      });
      return promise;
    },
  };
}
