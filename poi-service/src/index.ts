/**
 * CoffeeMode POI cache service — Cloudflare Worker entry.
 * Spec: docs/specs/0001-nextjs-migration.md § "POI cache service".
 */

import type { Env } from "./types";
import { internalError } from "./auth";
import { handleFetch } from "./handlers";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleFetch(request, env);
    } catch (e) {
      console.error("poi-service fatal:", e);
      return internalError();
    }
  },
};