/**
 * @vitest-environment node
 * BRAWUKA-666: bind the verified POI to the submitted coords. Pure check —
 * no network, no Supabase; every case is the haversine distance against
 * `cafes.placeProximityMaxKm`.
 */
import { describe, expect, it } from "vitest";
import { checkPlaceProximity } from "@/lib/places/place-proximity";
import type { POI } from "@shared/places/types";

function orchardPoi(): POI {
  return {
    place_id: "ChIJORCHARDNOMADSG",
    source: "google",
    name: "Orchard Nomad Roasters",
    lat: 1.3048,
    lng: 103.8318,
    address: "1 Orchard Rd, Singapore",
    types: ["cafe"],
    business_status: "OPERATIONAL",
    hours_json: null,
    fetched_at: "2026-01-15T08:00:00.000Z",
  };
}

describe("checkPlaceProximity (BRAWUKA-666)", () => {
  it("accepts identical coords (distance 0)", () => {
    const res = checkPlaceProximity({ lat: 1.3048, lng: 103.8318, poi: orchardPoi() }, 5);
    expect(res.ok).toBe(true);
    expect(res.distanceKm).toBeCloseTo(0, 6);
  });

  it("accepts a legit pin nudge (~100m) under the threshold", () => {
    const res = checkPlaceProximity({ lat: 1.3057, lng: 103.8318, poi: orchardPoi() }, 5);
    expect(res.ok).toBe(true);
    expect(res.distanceKm).toBeLessThan(5);
  });

  it("rejects a cross-city squat (Singapore POI, Tokyo coords)", () => {
    const res = checkPlaceProximity({ lat: 35.658, lng: 139.7016, poi: orchardPoi() }, 5);
    expect(res.ok).toBe(false);
    expect(res.distanceKm).toBeGreaterThan(5000);
  });
  it("is boundary-exact: >max rejects, ==max boundary passes", () => {
    const poi = orchardPoi();
    // ~5.6 km north of Orchard along the meridian — just past the 5 km cap.
    const outside = checkPlaceProximity({ lat: 1.3552, lng: 103.8318, poi }, 5);
    expect(outside.ok).toBe(false);
    expect(outside.distanceKm).toBeGreaterThan(5);

    // The measured distance itself as the cap — passes by construction.
    const boundary = checkPlaceProximity({ lat: 1.3552, lng: 103.8318, poi }, outside.distanceKm);
    expect(boundary.ok).toBe(true);
  });
});
