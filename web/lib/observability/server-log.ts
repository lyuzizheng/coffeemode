import "server-only";

import type { LogFields } from "@shared/log";

/**
 * Minimal server-side structured logger + request-id (BRAWUKA-168, ADR-0004).
 *
 * One JSON line per error, shaped to join with the proxy access log
 * (`type: "access"`) on `request_id`:
 *
 *   {"type":"error","request_id":"…","route":"GET /api/cafes","error":"…"}
 *
 * Rules:
 * - Only `message` (+ first stack frame) is recorded, never the whole
 *   error object or request bodies — callers MUST NOT pass user content
 *   (notes, bodies, tokens) as `error`.
 * - No dependencies, never throws: safe to call inside `catch` blocks.
 * - No AsyncLocalStorage: the ~30 callsites pass `requestId` explicitly
 *   (boring, greppable). Lib code without request context omits it
 *   (`request_id: null`).
 *
 * Implementation lives in `web/shared/log.ts` (spec 0011 D6, BRAWUKA-539)
 * so both Cloudflare Workers share it; this module keeps the `server-only`
 * boundary and the stable import path.
 */

// Request-id primitives live in `web/shared/request-id.ts` so the workers
// share them; re-exported here to keep this module's public API stable.
export { getRequestId, isValidRequestId, REQUEST_ID_HEADER } from "@shared/request-id";
export { logError, logWarn } from "@shared/log";
export type { LogFields };
/** Pre-0011 name for the shared log fields — kept for existing imports. */
export type ServerErrorFields = LogFields;
