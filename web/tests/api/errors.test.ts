import { describe, expect, it } from "vitest";
import { ApiHttpError } from "@/lib/api/api-error";
import { ERROR_CODES, defaultErrorStatus, isErrorCode } from "@shared/errors";

describe("ERROR_CODES registry (spec 0011 D3)", () => {
  it("holds only lower_snake_case codes with a status and domain", () => {
    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(entry.domain.length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeGreaterThan(0);
      if (entry.status !== "passthrough") {
        expect(entry.status).toBeGreaterThanOrEqual(400);
        expect(entry.status).toBeLessThan(600);
      }
    }
  });

  it("pins the spec's reclassified statuses", () => {
    expect(ERROR_CODES.cafe_has_other_checkins.status).toBe(409);
    expect(ERROR_CODES.invalid_photos.status).toBe(422);
    expect(ERROR_CODES.handle_change_too_soon.status).toBe(422);
    expect(ERROR_CODES.invalid_display_name.status).toBe(422);
    expect(ERROR_CODES.display_name_length.status).toBe(422);
    expect(ERROR_CODES.invalid_current_city.status).toBe(422);
    expect(ERROR_CODES.invalid_last_location.status).toBe(422);
    expect(ERROR_CODES.invalid_onboarded.status).toBe(422);
  });

  it("marks upstream-mirror codes as passthrough", () => {
    expect(ERROR_CODES.poi_service.status).toBe("passthrough");
    expect(ERROR_CODES.image_service_error.status).toBe("passthrough");
  });
});

describe("isErrorCode", () => {
  it("accepts registered codes and rejects anything else", () => {
    expect(isErrorCode("internal_error")).toBe(true);
    expect(isErrorCode("unregistered_code")).toBe(false);
    expect(isErrorCode(500)).toBe(false);
    expect(isErrorCode(null)).toBe(false);
  });
});

describe("defaultErrorStatus", () => {
  it("returns the registry status and falls back to 502 for passthrough", () => {
    expect(defaultErrorStatus("unauthorized")).toBe(401);
    expect(defaultErrorStatus("handle_change_too_soon")).toBe(422);
    expect(defaultErrorStatus("poi_service")).toBe(502);
  });
});

describe("ApiHttpError", () => {
  it("defaults status to the registry's canonical status", () => {
    const err = new ApiHttpError("handle_taken");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ApiHttpError");
    expect(err.code).toBe("handle_taken");
    expect(err.status).toBe(409);
    expect(err.message).toBe("handle_taken");
    expect(err.details).toBeUndefined();
  });

  it("carries message, explicit status, and details", () => {
    const err = new ApiHttpError("poi_service", "worker returned 404", {
      status: 404,
      details: { upstream: "poi" },
    });
    expect(err.message).toBe("worker returned 404");
    expect(err.status).toBe(404);
    expect(err.details).toEqual({ upstream: "poi" });
  });
});
