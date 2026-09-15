/**
 * CafeMood tiles service types (BRAWUKA-313).
 *
 * Only environment-specific structural interfaces live here — the Worker has
 * no shared product types (unlike poi-service, which shares POI types with
 * web/). Tests inject fakes; real Cloudflare bindings satisfy them at
 * runtime.
 */

/** Minimal structural interface so tests can inject fakes. */
export interface R2Like {
  get(
    key: string,
    options?: {
      range?: { offset: number; length: number } | { offset?: number; suffix?: number };
      onlyIf?: { etagMatches?: string };
    },
  ): Promise<R2ObjectLike | null>;
}

export interface R2ObjectHeadLike {
  readonly size: number;
  readonly etag: string;
  readonly uploaded?: Date;
  writeHttpMetadata(headers: Headers): void;
}

export interface R2ObjectLike extends R2ObjectHeadLike {
  readonly body: ReadableStream | null;
  readonly range?: { offset: number; length: number };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface Env {
  /** R2 bucket holding planet/*.pmtiles + fonts/sprites/styles (per-env). */
  TILES_BUCKET: R2Like;
  /**
   * Live planet version, e.g. `20260913_164504_pt` (a `[vars]` value per
   * env — rotated by editing wrangler.toml + redeploy on each monthly
   * promote; the TileJSON embeds it, so a version switch IS a deploy).
   */
  PLANET_VERSION: string;
  /** Allowed CORS origins, comma-separated (`*` echoes the request origin). */
  ALLOWED_ORIGINS?: string;
  /** Cache-Control for tile/TileJSON responses. */
  CACHE_CONTROL?: string;
}
