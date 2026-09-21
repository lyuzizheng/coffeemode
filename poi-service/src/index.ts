/**
 * CafeMood POI cache service — Cloudflare Worker entry.
 * Spec: docs/specs/0001-nextjs-migration.md § "POI cache service".
 */

import type { Env } from "./types";
import { internalError } from "./auth";
import { handleFetch } from "./handlers";
import { logError } from "../../web/shared/log";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleFetch(request, env);
    } catch (e) {
      logError({ route: "poi-service", request, error: e, status: 500, code: "internal_error" });
      return internalError(request);
    }
  },
};