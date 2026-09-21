import { apiFetch, isUnauthorized, UNAUTHORIZED } from "@/lib/http";
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

export function _resetMapKitStateForTests(): void {
  mapKitSessionExpired = false;
  pendingSearches.clear();
  scriptLoadingPromise = null;
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
          reject(new Error(t("searchFailed")));
        }
      };
      pendingSearches.add(fail);

      searchTimer = setTimeout(() => {
        cleanup();
        reject(new Error(t("searchFailed")));
      }, MAPKIT_SEARCH_TIMEOUT_MS);

      request.search(query, (searchError, response) => {
        cleanup();
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
