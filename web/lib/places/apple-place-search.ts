import { apiFetch, isUnauthorized, UNAUTHORIZED } from "@/lib/http";
import type { POI } from "@shared/places/types";
import { stableApplePlaceId } from "@shared/places/apple-place-id";
import type { CreateTranslator, PlaceCandidate, PlaceSearchProvider } from "./place-search";

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
  /** City-level address component (MapKit JS ≥5.41.1) — the reverse-geocode
   * payload BRAWUKA-696 persists as the runtime-city display name. */
  locality?: string;
}

interface MapKitSearch {
  search(
    query: string,
    callback: (error: unknown, response?: { places?: MapKitPlace[] }) => void,
  ): void;
}

interface MapKitGeocoder {
  /** 5.x ships both signatures: callback-first and the newer promise form. */
  reverseLookup(
    coordinate: unknown,
    callback?: (error: unknown, response?: { results?: MapKitPlace[] }) => void,
  ): void | Promise<{ results?: MapKitPlace[] }>;
}

interface MapKitApi {
  init(options: { authorizationCallback: (done: (token: string) => void) => void }): void;
  Search: new () => MapKitSearch;
  Coordinate: new (latitude: number, longitude: number) => unknown;
  Geocoder: new (options?: { language?: string }) => MapKitGeocoder;
  /** Newer 5.x services namespace; Geocoder moved here in later releases. */
  services?: { Geocoder?: new (options?: { language?: string }) => MapKitGeocoder };
}

interface MapKitWindow extends Window {
  mapkit?: MapKitApi;
  __coffeeModeMapKitInitialized?: boolean;
}

const MAPKIT_SCRIPT_TIMEOUT_MS = 10_000;
const MAPKIT_SEARCH_TIMEOUT_MS = 10_000;
let scriptLoadingPromise: Promise<void> | null = null;

export function loadMapKitScript(timeoutMs = MAPKIT_SCRIPT_TIMEOUT_MS): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${MAPKIT_SCRIPT}"]`);
  if (existing?.dataset.loaded === "true") return Promise.resolve();

  if (scriptLoadingPromise) return scriptLoadingPromise;

  if (existing && existing.dataset.failed === "true") {
    existing.remove();
  }

  const current = document.querySelector<HTMLScriptElement>(`script[src="${MAPKIT_SCRIPT}"]`);
  const isNew = !current;
  const script = current ?? document.createElement("script");

  scriptLoadingPromise = new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      script.onload = null;
      script.onerror = null;
      scriptLoadingPromise = null;
    };

    const onLoad = () => {
      cleanup();
      script.dataset.loaded = "true";
      delete script.dataset.failed;
      resolve();
    };

    const onError = () => {
      cleanup();
      script.dataset.failed = "true";
      script.remove();
      reject(new Error("MapKit script failed to load"));
    };

    const onTimeout = () => {
      cleanup();
      script.dataset.failed = "true";
      script.remove();
      reject(new Error("MapKit script load timed out"));
    };

    timer = setTimeout(onTimeout, timeoutMs);
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    script.onload = onLoad;
    script.onerror = onError;

    if (isNew) {
      script.src = MAPKIT_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return scriptLoadingPromise;
}

async function fetchMapKitToken(): Promise<string> {
  let data: { token?: string } | undefined;
  try {
    data = await apiFetch<{ token?: string }>("/api/mapkit-token", { cache: "no-store" });
  } catch (cause) {
    // 401 keeps the shared marker so the drawer's sign-in gate can claim it;
    // every other failure reads as "MapKit is not configured" to callers.
    if (isUnauthorized(cause)) throw cause;
    throw new Error("MapKit is not configured");
  }
  if (!data?.token) throw new Error("MapKit is not configured");
  return data.token;
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

/** Searches blocked on a MapKit authorization round-trip; drained on any auth failure. */
type PendingSearchFail = (reason?: { unauthorized?: boolean }) => void;
const pendingSearches = new Set<PendingSearchFail>();

async function fetchMapKitTokenTracked(): Promise<string> {
  try {
    const token = await fetchMapKitToken();
    mapKitSessionExpired = false;
    return token;
  } catch (cause) {
    const unauthorized = isUnauthorized(cause);
    if (unauthorized) {
      mapKitSessionExpired = true;
    }
    // Fail in-flight searches now: MapKit may never call their callbacks
    // after a failed authorization (whether 401 or non-401), and a hanging
    // spinner must not be the failure signal.
    for (const fail of [...pendingSearches]) {
      fail({ unauthorized });
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

/**
 * Shared MapKit JS bootstrap (BRAWUKA-696): token pre-flight, script load,
 * once-per-page `mapkit.init`. Returns null when the SDK script loaded but
 * exposed no `mapkit` global; every other failure (401, network, script
 * timeout) propagates so callers pick their own degradation.
 */
async function initMapKitApi(): Promise<MapKitApi | null> {
  await fetchMapKitTokenTracked();
  await loadMapKitScript();
  const windowWithMapKit = window as MapKitWindow;
  const mapkit = windowWithMapKit.mapkit;
  if (!mapkit) return null;
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
  return mapkit;
}

const MAPKIT_GEOCODE_TIMEOUT_MS = 10_000;

/**
 * Reverse-geocode a granted fix to its locality (city) name (BRAWUKA-696).
 * Display-only: every failure — token 401/503, script load, geocoder error,
 * empty results, missing locality — resolves to null so the caller keeps the
 * country fallback and never blocks onboarding.
 */
export async function reverseGeocodeLocality(
  lat: number,
  lng: number,
  language?: string,
): Promise<string | null> {
  try {
    const mapkit = await initMapKitApi();
    const Geocoder = mapkit?.services?.Geocoder ?? mapkit?.Geocoder;
    if (!mapkit || !Geocoder) return null;
    const geocoder = new Geocoder(language ? { language } : undefined);
    const coordinate = new mapkit.Coordinate(lat, lng);
    const place = await new Promise<MapKitPlace | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), MAPKIT_GEOCODE_TIMEOUT_MS);
      const finish = (value: MapKitPlace | null) => {
        clearTimeout(timer);
        resolve(value);
      };
      try {
        const maybePromise = geocoder.reverseLookup(
          coordinate,
          (error, response) => finish(error ? null : (response?.results?.[0] ?? null)),
        );
        if (maybePromise && typeof maybePromise.then === "function") {
          void maybePromise
            .then((response) => finish(response?.results?.[0] ?? null))
            .catch(() => finish(null));
        }
      } catch {
        finish(null);
      }
    });
    const locality = place?.locality?.trim();
    return locality || null;
  } catch {
    return null;
  }
}

export function _resetMapKitStateForTests(): void {
  mapKitSessionExpired = false;
  pendingSearches.clear();
  scriptLoadingPromise = null;
}

/** One MapKit search, with the SDK's callback + timeout folded into a promise.
 *  Results are full records, so each becomes a candidate that already carries
 *  its POI (MapKit has no separate details call). */
function runMapKitSearch(
  api: MapKitApi,
  query: string,
  messages: { failed: string },
): Promise<PlaceCandidate[]> {
  const request = new api.Search();
  const { promise, resolve, reject } = Promise.withResolvers<PlaceCandidate[]>();

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    pendingSearches.delete(fail);
  };

  const fail: PendingSearchFail = (reason) => {
    cleanup();
    if (reason?.unauthorized || mapKitSessionExpired) {
      reject(new Error(UNAUTHORIZED));
    } else {
      reject(new Error(messages.failed));
    }
  };
  pendingSearches.add(fail);

  searchTimer = setTimeout(() => {
    cleanup();
    reject(new Error(messages.failed));
  }, MAPKIT_SEARCH_TIMEOUT_MS);

  request.search(query, (searchError, response) => {
    cleanup();
    if (searchError) {
      reject(new Error(messages.failed));
      return;
    }
    const pois = (response?.places ?? []).map(toPOI).filter((poi): poi is POI => poi !== null);
    resolve(
      pois.map((poi) => ({
        poi,
        prediction: {
          place_id: poi.place_id,
          source: "apple",
          name: poi.name,
          address: poi.address,
          types: poi.types,
        },
      })),
    );
  });
  return promise;
}

export function applePlaceSearch(t: CreateTranslator): PlaceSearchProvider {
  let api: MapKitApi | null = null;
  return {
    id: "apple",
    label: t("apple"),
    persistOnSelect: true,
    async init() {
      const mapkit = await initMapKitApi();
      if (!mapkit) throw new Error(t("appleUnavailable"));
      api = mapkit;
    },
    async search(query) {
      if (!api) throw new Error(t("appleUnavailable"));
      // A re-auth 401 latched between init and now is the same dead session the
      // token fetch reports — route it to the sign-in gate, not the alert slot.
      if (mapKitSessionExpired) throw new Error(UNAUTHORIZED);
      return runMapKitSearch(api, query, { failed: t("searchFailed") });
    },
    // MapKit's `Search` is not a two-phase API: it returns full records with
    // coordinates in one call, so the candidate already carries its POI and
    // there is nothing left to resolve (and nothing to bill).
    async resolve(candidate) {
      if (!candidate.poi) throw new Error(t("searchFailed"));
      return candidate.poi;
    },
  };
}
