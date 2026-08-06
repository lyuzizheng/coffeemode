/**
 * CoffeeMode POI cache service — Cloudflare Worker entry.
 * Spec: docs/specs/0001-nextjs-migration.md § "POI cache service".
 */

import type { Env } from "./types";
import { handleFetch } from "./handlers";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, env);
  },
};