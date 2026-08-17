/**
 * Request authentication for the image upload service.
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
  const token = extractBearer(request, "x-image-service-token");
  if (!token || !env.IMAGE_SERVICE_TOKEN) return false;
  return safeEqual(token, env.IMAGE_SERVICE_TOKEN);
}
