import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createTranslator } from "next-intl";
import {
  ApiError,
  UNAUTHORIZED,
  apiErrorMessage,
  apiFetch,
  isUnauthorized,
  parseRetryAfterMs,
  throwIfUnauthorized,
} from "@/lib/http";
import zhMessages from "../messages/zh.json";

function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
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

describe("apiFetch (spec 0011 D9)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the parsed body on 2xx", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ cafe_id: "c1" }, 200));
    await expect(apiFetch<{ cafe_id: string }>("/api/cafes")).resolves.toEqual({ cafe_id: "c1" });
  });

  it("returns undefined for an empty 2xx body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiFetch("/api/checkins/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("throws the UNAUTHORIZED marker contract on 401", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    const failure = apiFetch("/api/profile");
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toSatisfy(isUnauthorized);
  });

  it("maps a non-JSON 5xx body to internal_error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    );
    const failure = apiFetch("/api/search?q=x");
    await expect(failure).rejects.toMatchObject({ status: 502, code: "internal_error" });
  });

  it("normalizes an unregistered code to internal_error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "brand_new_code" }, 400));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ code: "internal_error" });
  });

  it("surfaces request_id from the envelope and the response header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: "internal_error", request_id: "req-body" }, 500),
    );
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ requestId: "req-body" });

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: "handle_taken" }, 409, { "x-request-id": "req-header" }),
    );
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ requestId: "req-header" });
  });

  it("folds legacy top-level extras into details, details winning", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { error: "duplicate_checkin", existing_checkin_id: "legacy", details: { n: 2 } },
        409,
      ),
    );
    await expect(apiFetch("/api/checkins", { method: "POST" })).rejects.toMatchObject({
      code: "duplicate_checkin",
      details: { existing_checkin_id: "legacy", n: 2 },
    });
  });

  it("parses Retry-After on 429 into retryAfterMs", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: "rate_limited" }, 429, { "Retry-After": "7" }),
    );
    await expect(apiFetch("/api/search")).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterMs: 7000,
    });
  });

  it("keeps server message off err.message and on serverMessage", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: "invalid_handle", message: "Handle must be lowercase ASCII" }, 422),
    );
    const failure = await apiFetch("/api/profile/identity").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    const err = failure as ApiError;
    expect(err.message).toBe("invalid_handle");
    expect(err.serverMessage).toBe("Handle must be lowercase ASCII");
  });

  it("strips the query string from the logged context (audit P2)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = jsonResponse({ error: "internal_error", message: "db down" }, 500);
    Object.defineProperty(res, "url", { value: "https://app.test/api/search?q=secret+query" });
    vi.mocked(fetch).mockResolvedValueOnce(res);

    await expect(apiFetch("/api/search?q=secret+query")).rejects.toBeInstanceOf(ApiError);
    const context = (warn.mock.calls[0]?.[1] as { context?: string } | undefined)?.context ?? "";
    expect(context).toContain("https://app.test/api/search");
    expect(context).not.toContain("secret");
  });
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
  });

  it("parses an HTTP-date", () => {
    const future = new Date(Date.now() + 4000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(4000);
  });

  it("caps absurd values and rejects junk", () => {
    expect(parseRetryAfterMs("9999")).toBe(30_000);
    expect(parseRetryAfterMs("soon")).toBeUndefined();
    expect(parseRetryAfterMs("-3")).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });
});

describe("apiErrorMessage (spec 0011 D9)", () => {
  const zh = createTranslator({ locale: "zh", messages: zhMessages });

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders catalog copy for a mapped code — zh output has no English prose", () => {
    const err = new ApiError({
      status: 409,
      code: "handle_taken",
      serverMessage: "handle is already taken by another user",
    });
    const rendered = apiErrorMessage(err, "保存失败", zh);
    expect(rendered).toBe("这个 handle 已经被占用了");
    expect(rendered).not.toContain("taken by");
  });

  it("renders the localized fallback for an unmapped code — never the server message", () => {
    const err = new ApiError({
      status: 422,
      code: "invalid_display_name",
      serverMessage: "Display name violates domain rules",
    });
    expect(apiErrorMessage(err, "保存失败，再试试？", zh)).toBe("保存失败，再试试？");
  });

  it("maps a parsed envelope {error} the same way", () => {
    expect(apiErrorMessage({ error: "handle_taken" }, "fallback", zh)).toBe(
      "这个 handle 已经被占用了",
    );
  });

  it("falls back for an unknown envelope code and logs it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(apiErrorMessage({ error: "unregistered_thing" }, "fallback", zh)).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "unregistered_thing" }),
    );
  });

  it("falls back for a plain Error and withholds its message", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(apiErrorMessage(new Error("MapKit is not configured"), "fallback", zh)).toBe("fallback");
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "MapKit is not configured" }),
    );
  });

  it("still maps when no translator is passed", () => {
    expect(apiErrorMessage(new ApiError({ status: 404, code: "not_found" }), "fallback")).toBe(
      "fallback",
    );
  });
});
