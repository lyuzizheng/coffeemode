// --- POST /poi/external ---

import { json } from "../auth";
import { MAX_EXTERNAL_BATCH_SIZE } from "../constants";
import { isGooglePlaceId, matchesFoodCategory } from "../upstream";
import type { Env, POI } from "../types";
import { computeExpiresAt, d1GetPOI, d1UpsertPOIs, kvDeletePOI } from "../store";
import { inLatRange, inLngRange } from "./shared";

interface InvalidEntry {
  index: number;
  reason: string;
}

const MAX_EXTERNAL_STRING_LENGTH = 1000;

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

function validateExternalEntry(value: unknown, index: number): POI | InvalidEntry {
  const bad = (reason: string): InvalidEntry => ({ index, reason });
  if (!value || typeof value !== "object") return bad("entry is not an object");
  const v = value as Record<string, unknown>;
  if (typeof v.place_id !== "string" || v.place_id === "") return bad("place_id required");
  // Opaque provider ids (e.g. Apple MapKit) can be long; 1024 bounds storage
  // without truncating legitimate references.
  if (v.place_id.length > 1024) return bad("place_id too long (max 1024)");
  if (v.source !== "google" && v.source !== "apple") return bad("source must be google|apple");
  // BRAWUKA-566: an apple entry must never carry a Google-shaped id. place_id
  // is the D1 primary key and getPOI serves apple rows verbatim, so accepting
  // one here would poison the canonical Google row for that id (apple rows
  // never refresh upstream — the forgery would be permanent).
  if (v.source === "apple" && isGooglePlaceId(v.place_id)) {
    return bad("apple place_id must not use a Google id format");
  }
  if (typeof v.name !== "string" || v.name === "") return bad("name required");
  if (v.name.length > 200) return bad("name too long (max 200)");
  if (typeof v.lat !== "number" || !Number.isFinite(v.lat) || !inLatRange(v.lat)) {
    return bad("lat must be a finite number in [-90, 90]");
  }
  if (typeof v.lng !== "number" || !Number.isFinite(v.lng) || !inLngRange(v.lng)) {
    return bad("lng must be a finite number in [-180, 180]");
  }
  if (v.address !== undefined && v.address !== null && typeof v.address !== "string") {
    return bad("address must be a string");
  }
  if (typeof v.address === "string" && v.address.length > MAX_EXTERNAL_STRING_LENGTH) {
    return bad(`address too long (max ${MAX_EXTERNAL_STRING_LENGTH})`);
  }
  const types = stringArray(v.types);
  if (types === null) return bad("types must be an array of strings");
  if (v.business_status !== undefined && v.business_status !== null && typeof v.business_status !== "string") {
    return bad("business_status must be a string");
  }
  if (v.hours_json !== undefined && v.hours_json !== null && typeof v.hours_json !== "string") {
    return bad("hours_json must be a string");
  }
  if (typeof v.hours_json === "string" && v.hours_json.length > MAX_EXTERNAL_STRING_LENGTH) {
    return bad(`hours_json too long (max ${MAX_EXTERNAL_STRING_LENGTH})`);
  }
  // Must be parseable JSON — a malformed string would poison the stored row
  // and throw in downstream consumers (issue #39).
  if (typeof v.hours_json === "string") {
    try {
      JSON.parse(v.hours_json);
    } catch {
      return bad("hours_json must be valid JSON");
    }
  }
  const now = new Date().toISOString();
  return {
    place_id: v.place_id,
    source: v.source,
    name: v.name,
    lat: v.lat,
    lng: v.lng,
    address: typeof v.address === "string" ? v.address : null,
    types,
    business_status: typeof v.business_status === "string" ? v.business_status : null,
    hours_json: typeof v.hours_json === "string" ? v.hours_json : null,
    fetched_at: now,
    expires_at: computeExpiresAt(now),
  };
}

export async function storeExternal(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null);
  const entries: unknown = Array.isArray(body)
    ? body
    : body && typeof body === "object" && "pois" in body
      ? (body as Record<string, unknown>).pois
      : undefined;
  if (!Array.isArray(entries) || entries.length === 0) {
    return json({ error: "invalid_request", message: "pois array required" }, 400, request);
  }
  if (entries.length > MAX_EXTERNAL_BATCH_SIZE) {
    return json(
      { error: "invalid_request", message: `at most ${MAX_EXTERNAL_BATCH_SIZE} entries per request` },
      400,
      request,
    );
  }

  const validated = entries.map(validateExternalEntry);
  const invalid = validated.filter((v): v is InvalidEntry => "reason" in v);
  if (invalid.length > 0) {
    return json({ error: "invalid_request", message: "invalid entries", entries: invalid }, 400, request);
  }

  // BRAWUKA-328 — DG144/DG52 category gate for this path: source-aware
  // `matchesFoodCategory` (Google `isGoogleFoodOrCafePOI` semantics, Apple
  // MapKit category map; `getUpstreamProvider("apple")` is null by design so
  // the Apple arm cannot go through `provider.matchesCategory`). Skipped
  // entries never touch D1/KV and are reported with a reason instead of
  // failing the whole batch (creation-sheet selects one POI at a time, and
  // a 400 would look like a broken search).
  const pois = validated as POI[];
  const skipped: InvalidEntry[] = [];
  const candidates: Array<{ poi: POI; index: number }> = [];
  for (const [i, poi] of pois.entries()) {
    if (matchesFoodCategory(poi.source, poi.types)) {
      candidates.push({ poi, index: i });
    } else {
      skipped.push({ index: i, reason: "non_food_category" });
    }
  }
  // BRAWUKA-566: never let one source overwrite the other's row. place_id is
  // the D1 primary key, so an apple entry reusing a google id would replace
  // the real row and getPOI would serve the forgery forever (apple rows never
  // refresh upstream). Conflicts skip per-entry like the category gate above;
  // same-source upserts still replace normally.
  const storedRows = await Promise.all(
    candidates.map(({ poi }) => d1GetPOI(env.POI_DB, poi.place_id)),
  );
  const toPersist: POI[] = [];
  candidates.forEach(({ poi, index }, j) => {
    const stored = storedRows[j];
    if (stored && stored.source !== poi.source) {
      skipped.push({ index, reason: "source_conflict" });
      return;
    }
    toPersist.push(poi);
  });
  // Atomic batch: one round-trip, all-or-nothing (no partial writes on failure).
  // Then invalidate the KV hot cache for every written id: getPOI serves KV
  // hits without consulting D1, so a stale raw entry (up to CACHE_TTL_SECONDS
  // old) would otherwise shadow the fresh D1 row (BRAWUKA-283 P2-1). A
  // delete storm races the cache-write path, not the read path — a lost
  // delete would only resurrect a stale entry, never serve a write that
  // never happened — so a best-effort post-write delete is the safe order.
  await d1UpsertPOIs(env.POI_DB, toPersist);
  await Promise.all(toPersist.map((poi) => kvDeletePOI(env.POI_KV, poi.place_id)));
  return json({ stored: toPersist.length, skipped }, request);
}
