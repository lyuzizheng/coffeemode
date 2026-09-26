import "server-only";

import { createHash } from "node:crypto";

import { appConfig } from "@/lib/config";
import { cafesDataVersion } from "@/lib/db/search";
import { emitSearchTelemetry, executeSearch } from "./search-service";
import type { SearchFilters, SearchServiceResponse } from "./types";

/**
 * In-process edge cache for GET /api/search (DG137-C, BRAWUKA-25).
 *
 * Single VPS → a module-level Map is sufficient; no KV/Redis. Entries live
 * `search.edgeCache.ttlSeconds` and are invalidated early when the cafes
 * data version (max(updated_at) + row count) moves — a check-in's
 * work_stats recompute commits in the same transaction, so a check-in is
 * visible without waiting out the TTL.
 *
 * The key covers every input that can change the response: city, q, the
 * full filter set (incl. viewer_id — private cafes must never leak across
 * viewers), and the reference coordinates.
 */

export type SearchCacheStatus = "hit" | "miss";

interface CacheEntry {
  expiresAt: number;
  /** cafesDataVersion() captured before the fill query ran. */
  version: string;
  response: SearchServiceResponse;
}

const cache = new Map<string, CacheEntry>();

function filtersHash(filters: SearchFilters): string {
  // Fixed key order → deterministic serialization regardless of caller.
  const canonical = {
    lat: filters.lat ?? null,
    lng: filters.lng ?? null,
    open_now: filters.open_now === true,
    include_live: filters.include_live === true,
    filter_wifi: filters.filter_wifi ?? null,
    filter_outlets: filters.filter_outlets ?? null,
    filter_seats: filters.filter_seats ?? null,
    filter_temp: filters.filter_temp ?? null,
    filter_coffee: filters.filter_coffee ?? null,
    filter_overall: filters.filter_overall ?? null,
    filter_max_stay: filters.filter_max_stay ?? null,
    limit: filters.limit ?? null,
    ranking: filters.ranking ?? null,
    viewer_id: filters.viewer_id ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 24);
}

/**
 * UTC-minute bucket scoping open_now entries. Open/closed status moves with
 * wall-clock time, not with cafes writes, so an open_now entry must never
 * survive a minute boundary — a cafe opening/closing mid-TTL is re-evaluated
 * on the next minute's first request (stale ≤ ~60s). Non-open_now keys are
 * byte-identical to before (no bucket segment).
 */
const OPEN_NOW_BUCKET_MS = 60_000;

export function searchCacheKey(filters: SearchFilters, now: number = Date.now()): string {
  const base = `${filters.city ?? ""}:${filters.q ?? ""}:${filtersHash(filters)}`;
  if (filters.open_now !== true) return base;
  return `${base}:m${Math.floor(now / OPEN_NOW_BUCKET_MS)}`;
}

/**
 * Returns the cached response when the entry is fresh AND still matches the
 * current data version; otherwise evicts and returns null.
 */
export function readSearchCache(
  key: string,
  currentVersion: string,
  now: number = Date.now(),
): SearchServiceResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now || entry.version !== currentVersion) {
    cache.delete(key);
    return null;
  }
  // Callers must not mutate shared state across requests.
  return structuredClone(entry.response);
}

export function writeSearchCache(
  key: string,
  version: string,
  response: SearchServiceResponse,
  now: number = Date.now(),
): void {
  const maxEntries = appConfig.search.edgeCache.maxEntries;
  if (cache.size >= maxEntries) {
    // Insertion-ordered Map: drop expired entries first, then the oldest.
    for (const [k, e] of cache) {
      if (e.expiresAt <= now) cache.delete(k);
    }
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  cache.set(key, {
    expiresAt: now + appConfig.search.edgeCache.ttlSeconds * 1000,
    version,
    response: structuredClone(response),
  });
}

/** Test hook: drop every entry (module state persists across tests). */
export function clearSearchCache(): void {
  cache.clear();
}

/**
 * E2E latency-proof hook (BRAWUKA-755, audit-t28 follow-up): sleeps a capped
 * interval inside the real handler dependency path when
 * `E2E_ACCESS_LOG_DELAY_MS` is set, so the T28 gate can assert `duration_ms`
 * covers handler latency (a zero or pre-handler timer then fails the lower
 * bound). Default off — production is unchanged unless the harness opts in;
 * capped at 500ms so a stray value cannot stall the route.
 */
async function e2eAccessLogDelay(): Promise<void> {
  const raw = process.env.E2E_ACCESS_LOG_DELAY_MS;
  if (!raw) return;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return;
  const capped = Math.min(parsed, 500);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, capped);
  });
}

/**
 * Cache-aware wrapper around executeSearch for GET /api/search. Emits the
 * `search.telemetry` line for both paths (hits re-emit from the cached
 * response so hit/miss ratios stay measurable). A failed data-version read
 * bypasses the cache entirely rather than serving an entry whose freshness
 * cannot be proven.
 */
export async function executeSearchCached(
  filters: SearchFilters,
  now: number = Date.now(),
  requestId?: string,
): Promise<{ response: SearchServiceResponse; cache: "hit" | "miss" | "bypass" }> {
  await e2eAccessLogDelay();
  const version = await cafesDataVersion().catch(() => null);
  const key = searchCacheKey(filters, now);

  if (version !== null) {
    const cached = readSearchCache(key, version, now);
    if (cached) {
      emitSearchTelemetry({
        mode: cached.search_mode ?? "stored_only",
        durationMs: 0,
        truncated: cached.total_count > cached.results.length,
        poiDegraded:
          (cached.warnings ?? []).includes("poi_unavailable") ||
          (cached.warnings ?? []).includes("live_poi_unavailable"),
        cache: "hit",
      });
      return { response: cached, cache: "hit" };
    }
  }

  // One instant for the whole fill so the cache bucket, the SQL open_now
  // predicate, and the in-memory post-check can never disagree about "now".
  const instant = new Date(now);
  const response = await executeSearch(
    filters,
    instant,
    version !== null ? "miss" : "bypass",
    requestId,
  );
  if (version !== null) {
    writeSearchCache(key, version, response, now);
  }
  return { response, cache: version !== null ? "miss" : "bypass" };
}
