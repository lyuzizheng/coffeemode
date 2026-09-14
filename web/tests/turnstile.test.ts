import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_ACTION_PLACES_RESOLVE,
  TURNSTILE_SITEVERIFY_URL,
  verifyTurnstileToken,
} from "@/lib/security/turnstile";

const SECRET = "test-turnstile-secret";

function resolveRequest(host = "localhost:3000", forwardedFor?: string): Request {
  const headers: Record<string, string> = { host };
  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
  return new Request(`http://${host}/api/places/resolve`, { method: "POST", headers });
}

function siteverifyResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SITEVERIFY_SUCCESS = {
  success: true,
  action: TURNSTILE_ACTION_PLACES_RESOLVE,
  hostname: "localhost",
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.TURNSTILE_SECRET_KEY = SECRET;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TURNSTILE_SECRET_KEY;
  vi.unstubAllGlobals();
});

describe("verifyTurnstileToken", () => {
  it("accepts a valid token for the places-resolve action and hostname", async () => {
    fetchMock.mockResolvedValue(siteverifyResponse(SITEVERIFY_SUCCESS));
    const result = await verifyTurnstileToken("fresh-token", resolveRequest());
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    const params = new URLSearchParams(String(init.body));
    expect(params.get("secret")).toBe(SECRET);
    expect(params.get("response")).toBe("fresh-token");
  });

  it("rejects a missing token without calling siteverify", async () => {
    for (const token of [undefined, "", "x".repeat(2049)]) {
      const result = await verifyTurnstileToken(token, resolveRequest());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("turnstile_required");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a forged token and never reaches the worker", async () => {
    fetchMock.mockResolvedValue(siteverifyResponse({ success: false, "error-codes": ["invalid-input-response"] }));
    const result = await verifyTurnstileToken("forged-token", resolveRequest());
    expect(result).toEqual({
      ok: false,
      code: "turnstile_rejected",
      message: "bot verification failed, please retry",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when siteverify returns 5xx", async () => {
    fetchMock.mockResolvedValue(siteverifyResponse({ error: "boom" }, 500));
    const result = await verifyTurnstileToken("token", resolveRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("turnstile_unavailable");
  });

  it("fails closed on siteverify network error or timeout", async () => {
    fetchMock.mockRejectedValue(new Error("connection reset"));
    const result = await verifyTurnstileToken("token", resolveRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("turnstile_unavailable");
  });

  it("rejects action and hostname mismatches", async () => {
    fetchMock.mockResolvedValue(
      siteverifyResponse({ ...SITEVERIFY_SUCCESS, action: "login" }),
    );
    expect((await verifyTurnstileToken("token", resolveRequest())).ok).toBe(false);

    fetchMock.mockResolvedValue(
      siteverifyResponse({ ...SITEVERIFY_SUCCESS, hostname: "evil.com" }),
    );
    const mismatch = await verifyTurnstileToken("token", resolveRequest());
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.code).toBe("turnstile_rejected");
  });

  it("forwards the client IP to siteverify when present", async () => {
    fetchMock.mockResolvedValue(siteverifyResponse(SITEVERIFY_SUCCESS));
    await verifyTurnstileToken("token", resolveRequest("localhost:3000", "203.0.113.7"));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("remoteip=203.0.113.7");
  });

  it("fails closed in production when the secret is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.TURNSTILE_SECRET_KEY;
    const result = await verifyTurnstileToken("token", resolveRequest());
    expect(result).toEqual({
      ok: false,
      code: "turnstile_not_configured",
      message: "bot verification is not configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("skips verification outside production when the secret is not configured", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const result = await verifyTurnstileToken(undefined, resolveRequest());
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
