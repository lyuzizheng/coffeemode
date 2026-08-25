import { describe, expect, it } from "vitest";
import { haversineDistanceM } from "@/lib/search/distance";

describe("haversineDistanceM", () => {
  it("calculates zero distance for identical coordinates", () => {
    expect(haversineDistanceM(1.3521, 103.8198, 1.3521, 103.8198)).toBe(0);
  });

  it("calculates accurate distance between Singapore center and Orchard Road", () => {
    // Orchard Road approx (1.3048, 103.8318) to Singapore center (1.3521, 103.8198) is ~5.4 km
    const dist = haversineDistanceM(1.3521, 103.8198, 1.3048, 103.8318);
    expect(dist).toBeGreaterThan(5000);
    expect(dist).toBeLessThan(6000);
  });

  it("calculates accurate distance between Tokyo and Singapore", () => {
    // Tokyo (35.6762, 139.6503) to Singapore (1.3521, 103.8198) is ~5300 km
    const dist = haversineDistanceM(35.6762, 139.6503, 1.3521, 103.8198);
    expect(dist).toBeGreaterThan(5_200_000);
    expect(dist).toBeLessThan(5_400_000);
  });
});
