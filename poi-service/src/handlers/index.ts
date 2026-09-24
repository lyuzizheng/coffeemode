/**
 * HTTP handlers for the POI endpoints — routing module.
 * One handler per file under this directory (BRAWUKA-549): this module owns
 * route dispatch and the error-isolation wrapper only.
 * Pure functions over injected Env/Deps — unit-testable without a Worker runtime.
 *
 * Endpoints:
 *   Unauthenticated:
 *     GET  /                 service probe
 *     GET  /health           health check
 *   Token-gated (require POI_SERVICE_TOKEN):
 *     GET  /poi/:place_id    KV hot → D1 fresh → Google API → backfill both
 *                            (?session=<uuid> terminates an Autocomplete session)
 *     POST /poi/resolve      {maps_share_url} → POI (creation import path)
 *     GET  /poi/search       ?q&lat&lng&r — stored POIs, name match + haversine sort
 *     GET  /poi/autocomplete ?q&lat&lng&r&session — live Google predictions
 *                            (typing phase; nothing is persisted)
 *     POST /poi/external     store externally-searched POIs (Apple MapKit refs)
 *
 * Google billing model (BRAWUKA-602): the typing phase is Autocomplete (New)
 * and the selection phase is Place Details (New). Both carry the same session
 * token, so every Autocomplete request in the session bills at
 * `Autocomplete Session Usage` ($0) and only the Place Details call is
 * charged. Text Search (New) is deliberately absent — its field-mask pricing
 * billed every keystroke at the Enterprise tier.
 *
 * Error isolation (W1): handleFetch wraps every handler in try/catch and maps
 * uncaught D1/KV/Google failures to a JSON 500 envelope — workerd's opaque
 * default error page never escapes to callers.
 *
 * Error envelope shape is shared with image-service: { error: code, message? }.
 */

import { authorized, internalError, json, unauthorized } from "../auth";
import { logError, logWarn } from "../../../web/shared/log";
import type { Deps, Env } from "../types";
import { getPOI } from "./get-poi";
import { resolvePOI } from "./resolve-poi";
import { searchPOIs } from "./search-pois";
import { autocompletePOIs } from "./autocomplete-pois";
import { storeExternal } from "./store-external";
import { SESSION_TOKEN_RE } from "./shared";

const ROUTE_RE = /^\/poi\/([^/]+)$/;

export async function handleFetch(
  request: Request,
  env: Env,
  deps: Deps = { fetchImpl: fetch },
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && (path === "/" || path === "/health")) {
      return json({ ok: true, service: "poi-service" }, request);
    }

    if (!(await authorized(request, env))) {
      logWarn({ route: "auth", request, error: "unauthorized", status: 401, code: "unauthorized" });
      return unauthorized(request);
    }

    if (request.method === "GET" && path === "/poi/autocomplete") {
      return await autocompletePOIs(request, env, deps);
    }
    if (request.method === "GET" && path === "/poi/search") return await searchPOIs(request, env, deps);
    if (request.method === "POST" && path === "/poi/resolve") return await resolvePOI(request, env, deps);
    if (request.method === "POST" && path === "/poi/external") return await storeExternal(request, env);

    const m = path.match(ROUTE_RE);
    if (request.method === "GET" && m) {
      // Path segments arrive percent-encoded; decode before lookup. Google
      // hex ids contain ':' which standard clients encode as %3A.
      let placeId: string;
      try {
        placeId = decodeURIComponent(m[1]);
      } catch {
        return json({ error: "invalid_request", message: "malformed place_id encoding" }, 400, request);
      }
      if (placeId === "") return json({ error: "not_found" }, 404, request);
      // `session` terminates the Autocomplete session that produced this id.
      // A malformed token is ignored rather than rejected: the lookup itself
      // is still valid, it just loses the session discount.
      const session = url.searchParams.get("session")?.trim() ?? "";
      return await getPOI(
        placeId,
        env,
        deps,
        request,
        SESSION_TOKEN_RE.test(session) ? session : undefined,
      );
    }

    return json({ error: "not_found" }, 404, request);
  } catch (e) {
    logError({ route: "poi-service", request, error: e, status: 500, code: "internal_error" });
    return internalError(request);
  }
}
