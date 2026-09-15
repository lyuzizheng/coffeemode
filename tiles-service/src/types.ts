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
  get(key: string, options?: { range?: { offset: number; length: number } | { offset?: number; suffix?: number } }): Promise<R2ObjectLike | null>;
  head(key: string): Promise<R2ObjectHeadLike | null>;
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
}

export interface Env {
  /** R2 bucket holding planet/*.pmtiles + fonts/sprites/styles (per-env). */
  TILES_BUCKET: R2Like;
  /**
   * Live planet version, e.g. `20260913_164504_pt` (plain `wrangler secret`
   * value per env — rotated by build-maptiles.sh on each monthly promote).
   * Kept out of the bucket so a version switch needs no redeploy.
   */
  PLANET_VERSION: string;
  /** Public basemap origin, e.g. `https://tiles.cafemood.app` (staging: staging-tiles). */
  TILES_PUBLIC_ORIGIN?: string;
}

export interface Deps {
  fetchImpl: typeof fetch;
}
