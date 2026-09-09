import { randomUUID } from "node:crypto";
import type { POI, POISearchResponse } from "@shared/places/types";
import { fakeJwt } from "./auth";
import { tinyWebP } from "./r2";

/**
 * Journey mock factories (spec 0007 §10): the three seams where Stage-2
 * tests substitute fakes for the outside world. Real boundaries:
 * live Google via the poi-service worker, real R2/sharp image pipeline,
 * real Supabase Auth — none of which unit/journey tests may touch.
 */

const GOOGLE_POI_FIXTURE_BASE = {
  source: "google",
  business_status: "OPERATIONAL",
  fetched_at: "2026-01-15T08:00:00.000Z",
} as const;

function googlePoiDefaults(index: number): POI {
  const orchard = index === 0;
  return {
    place_id: orchard ? "ChIJORCHARDNOMADSG" : "ChIJBUGISOUTLETSG",
    source: GOOGLE_POI_FIXTURE_BASE.source,
    name: orchard ? "Orchard Nomad Roasters" : "Bugis Outlet Haven",
    lat: orchard ? 1.3048 : 1.2996,
    lng: orchard ? 103.8318 : 103.8552,
    address: orchard ? "1 Orchard Rd, Singapore" : "244 Beach Rd, Singapore",
    types: ["cafe", "food", "point_of_interest", "establishment"],
    business_status: GOOGLE_POI_FIXTURE_BASE.business_status,
    hours_json: JSON.stringify({
      weekdayDescriptions: [
        "Monday: 8:00 AM – 10:00 PM",
        "Tuesday: 8:00 AM – 10:00 PM",
        "Wednesday: 8:00 AM – 10:00 PM",
        "Thursday: 8:00 AM – 10:00 PM",
        "Friday: 8:00 AM – 11:00 PM",
        "Saturday: 9:00 AM – 11:00 PM",
        "Sunday: 9:00 AM – 9:00 PM",
      ],
    }),
    photo_refs: [
      `places/${orchard ? "ChIJORCHARDNOMADSG" : "ChIJBUGISOUTLETSG"}/photos/photo-${index}`,
    ],
    fetched_at: GOOGLE_POI_FIXTURE_BASE.fetched_at,
  };
}

/**
 * Build a Google Places intercept payload in the exact `POISearchResponse`
 * shape `searchExternalPOIs` returns. `overrides` merges into every default
 * hit (e.g. `{ name: "X" }`); pass distinct `place_id`s when a test needs
 * non-colliding hits.
 */
export function createMockGooglePlacesResponse(
  overrides: Partial<POI> = {},
): POISearchResponse {
  return {
    results: [googlePoiDefaults(0), googlePoiDefaults(1)].map((poi) => ({
      ...poi,
      ...overrides,
    })),
  };
}

export interface FakeImageUpload {
  imageUuid: string;
  buffer: Uint8Array;
  contentType: "image/webp";
  filename: string;
  size: number;
}

/**
 * Build a fake image upload: a minimal valid WebP buffer (RIFF…WEBP magic,
 * same bytes as `tinyWebP`) with a fresh v4 `imageUuid`. Tests that need a
 * rejection path pass their own `buffer` (e.g. oversized or non-image bytes)
 * while keeping the intent/complete plumbing identical.
 */
export function createFakeImageUpload(buffer?: Uint8Array): FakeImageUpload {
  const bytes = buffer ?? tinyWebP();
  const imageUuid = randomUUID();
  return {
    imageUuid,
    buffer: bytes,
    contentType: "image/webp",
    filename: `${imageUuid}.webp`,
    size: bytes.byteLength,
  };
}

export interface TestSessionUser {
  id: string;
  displayName: string;
  currentCity: string;
  /** Unsigned HS256 JWT for the Supabase auth mock (`fakeJwt` shape). */
  jwt: string;
}

/**
 * Build a test session user with deterministic defaults. The id is a fresh
 * v4 UUID unless overridden. Pair with `stubGetCurrentUser({ id })` for
 * route tests; profile-row insertion stays with the caller's seeder
 * (`seedMockDataset` / `seedBaseData` own their profiles).
 */
export function createTestSessionUser(
  userConfig: Partial<Omit<TestSessionUser, "jwt">> = {},
): TestSessionUser {
  const id = userConfig.id ?? randomUUID();
  const user: TestSessionUser = {
    id,
    displayName: userConfig.displayName ?? "Test Nomad",
    currentCity: userConfig.currentCity ?? "singapore",
    jwt: fakeJwt(id),
  };
  return user;
}
