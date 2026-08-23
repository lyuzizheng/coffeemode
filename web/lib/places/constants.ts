import { DEFAULT_SEARCH_RADIUS_KM } from "@shared/places/constants";
import { appConfig } from "@/lib/config";

export { DEFAULT_SEARCH_RADIUS_KM };

/**
 * Maximum allowed nearby search radius in kilometres — the product cap
 * (spec 0001). The POI worker's own bounding-box ceiling (200 km) lives in
 * web/shared; this proxy cap is deliberately stricter. The value lives in
 * `web/config/app.yaml` (`search.maxRadiusKm`, DG107).
 */
export const MAX_SEARCH_RADIUS_KM = appConfig.search.maxRadiusKm;
