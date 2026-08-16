/**
 * Request authentication for the POI cache service.
 *
 * Thin environment wrapper over `web/shared/auth.ts` (issue #26):
 * the shared module owns constant-time comparison, Bearer extraction
 * (case-insensitive per RFC 6750), and the JSON error envelope.
 */

import type { Env } from "./types";
import {
  extractBearer,
  internalError,
  json,
  safeEqual,
  unauthorized,
} from "../../web/shared/auth";

export { internalError, json, unauthorized };

export async function authorized(request: Request, env: Env): Promise<boolean> {
  const token = extractBearer(request, "x-poi-service-token");
  if (!token || !env.POI_SERVICE_TOKEN) return false;
  return safeEqual(token, env.POI_SERVICE_TOKEN);
}
