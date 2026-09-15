/**
 * CafeMood tiles service — Cloudflare Worker entry (BRAWUKA-313).
 * Spec: BRAWUKA-308 §3 (PMTiles+R2 self-host), runbook docs/devops/maptiles-runbook.md.
 */

import { handleFetch } from "./handlers";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleFetch(request, env, ctx);
    } catch (e) {
      console.error("tiles-service fatal:", e);
      return new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  },
};
