import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  UNAUTHORIZED,
  isUnauthorized,
  responseMessage,
  throwIfUnauthorized,
  userFacingMessage,
} from "@/lib/http";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("session expiry marker", () => {
  it("raises the shared marker on 401 and nothing else", () => {
    expect(() => throwIfUnauthorized(jsonResponse({ error: "unauthorized" }, 401))).toThrow(
      UNAUTHORIZED,
    );
    expect(() => throwIfUnauthorized(jsonResponse({ error: "internal_error" }, 500))).not.toThrow();
    expect(() => throwIfUnauthorized(jsonResponse({ error: "rate_limited" }, 429))).not.toThrow();
  });

  it("recognizes the marker wherever it crosses a module boundary", () => {
    expect(isUnauthorized(new Error(UNAUTHORIZED))).toBe(true);
    // A transport helper may hand over the bare string; unknown values are not the marker.
    expect(isUnauthorized(UNAUTHORIZED)).toBe(false);
    expect(isUnauthorized(new Error("photo_upload_failed"))).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });
});

describe("responseMessage (BRAWUKA-212)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("withholds a bare machine code and logs it for triage", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const message = await responseMessage(
      jsonResponse({ error: "internal_error" }, 500),
      "The cafe could not be created.",
    );

    expect(message).toBe("The cafe could not be created.");
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "internal_error" }),
    );
  });

  it("keeps route-authored prose, which is written for users", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const message = await responseMessage(
      jsonResponse({ error: "rate_limited", message: "too many requests, please try again later" }, 429),
      "Search is unavailable right now.",
    );

    expect(message).toBe("too many requests, please try again later");
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back when the body is not JSON at all", async () => {
    const message = await responseMessage(
      new Response("<html>502 Bad Gateway</html>", { status: 502 }),
      "Search is unavailable right now.",
    );

    expect(message).toBe("Search is unavailable right now.");
  });
});

describe("userFacingMessage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces a code-shaped failure with the caller's copy", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(userFacingMessage("image_processing_error", "The cafe could not be created.")).toBe(
      "The cafe could not be created.",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "image_processing_error" }),
    );
  });

  it("passes authored prose through", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(userFacingMessage("one or more photos are invalid", "fallback")).toBe(
      "one or more photos are invalid",
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
