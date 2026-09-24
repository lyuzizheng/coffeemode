/**
 * CafeMood POI cache service — Cloudflare Worker entry.
 * Spec: docs/specs/0001-nextjs-migration.md § "POI cache service".
 */

import type { Env } from "./types";
import { internalError } from "./auth";
import { handleFetch } from "./handlers/index";
import { purgeExpiredPOIs } from "./store";
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

  /**
   * Nightly bounded-cache cleanup (wrangler.toml [triggers]). Deletes rows
   * past their 30d TTL via idx_pois_expires_at. Best-effort: a failure is
   * logged for the next run, never thrown — reads already hide expired rows
   * via the expires_at filter, so a missed run is invisible (BRAWUKA-645).
   */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      await purgeExpiredPOIs(env.POI_DB);
    } catch (e) {
      logError({ route: "scheduled purge-expired", error: e });
    }
  },
};