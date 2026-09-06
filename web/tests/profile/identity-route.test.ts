import type * as IdentityDb from "@/lib/db/identity";
import type * as RateLimitModule from "@/lib/rate-limit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/profile/identity/route";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  updateProfileIdentity,
  InvalidHandleError,
  HandleTakenError,
  HandleChangeTooSoonError,
  ProfileNotFoundError,
} from "@/lib/db/identity";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/security/origin";
import { NextResponse, type NextRequest } from "next/server";

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/security/origin", () => ({
  requireSameOrigin: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/db/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof IdentityDb>();
  return {
    ...actual,
    updateProfileIdentity: vi.fn(),
  };
});

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof RateLimitModule>("@/lib/rate-limit");
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: Date.now(),
      retryAfter: 0,
    }),
  };
});

describe("PATCH /api/profile/identity", () => {
  const userId = "00000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(requireSameOrigin).mockReturnValue(null);
    vi.mocked(updateProfileIdentity).mockReset();
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: Date.now(),
      retryAfter: 0,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicIdentity: true }),
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns CSRF/origin error when requireSameOrigin fails", async () => {
    vi.mocked(requireSameOrigin).mockReturnValueOnce(
      NextResponse.json({ error: "cross_origin_denied" }, { status: 403 }),
    );
    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("cross_origin_denied");
  });

  it("returns 429 when identity-write rate limit trips", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
      retryAfter: 60,
    });

    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicIdentity: true }),
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
  });

  it("returns 400 when body is invalid JSON or not an object", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 when showPublicIdentity is not boolean", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicIdentity: "yes" }),
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(body.message).toContain("showPublicIdentity (boolean) required");
  });

  it("returns 400 when publicHandle is not a string", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicIdentity: true, publicHandle: 12345 }),
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(body.message).toContain("publicHandle must be a string");
  });

  it("returns 400 with invalid_handle when handle does not meet regex requirements", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    vi.mocked(updateProfileIdentity).mockRejectedValueOnce(new InvalidHandleError());

    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicIdentity: true, publicHandle: "Invalid-Caps!" }),
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_handle");
  });

  it("returns 409 with handle_taken when handle is already claimed", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    vi.mocked(updateProfileIdentity).mockRejectedValueOnce(new HandleTakenError());

    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicIdentity: true, publicHandle: "already-taken" }),
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("handle_taken");
  });

  it("returns 400 with handle_change_too_soon when handle was changed within 7 days", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    vi.mocked(updateProfileIdentity).mockRejectedValueOnce(new HandleChangeTooSoonError());

    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicIdentity: true, publicHandle: "too-soon" }),
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("handle_change_too_soon");
  });

  it("returns 404 with profile_not_found when user profile does not exist", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    vi.mocked(updateProfileIdentity).mockRejectedValueOnce(new ProfileNotFoundError());

    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicIdentity: true }),
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("profile_not_found");
  });

  it("returns 200 and updated identity state on successful opt-in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    vi.mocked(updateProfileIdentity).mockResolvedValueOnce({
      showPublicIdentity: true,
      publicHandle: "alex-4a1f",
      identityConsentedAt: "2026-09-06T12:00:00.000Z",
      publicHandleChangedAt: null,
    });

    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicIdentity: true }),
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.showPublicIdentity).toBe(true);
    expect(body.publicHandle).toBe("alex-4a1f");
    expect(body.identityConsentedAt).toBe("2026-09-06T12:00:00.000Z");
    expect(body.publicHandleChangedAt).toBeNull();
    // Also asserts snake_case parity
    expect(body.show_public_identity).toBe(true);
    expect(body.public_handle).toBe("alex-4a1f");
  });

  it("returns 200 on successful opt-out, retaining reserved handle", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    vi.mocked(updateProfileIdentity).mockResolvedValueOnce({
      showPublicIdentity: false,
      publicHandle: "alex-4a1f",
      identityConsentedAt: null,
      publicHandleChangedAt: null,
    });

    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicIdentity: false }),
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.showPublicIdentity).toBe(false);
    expect(body.publicHandle).toBe("alex-4a1f");
    expect(body.identityConsentedAt).toBeNull();
  });

  it("returns 500 when updateProfileIdentity throws an unexpected error", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    vi.mocked(updateProfileIdentity).mockRejectedValueOnce(new Error("DB boom"));

    const req = new Request("http://localhost/api/profile/identity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicIdentity: true }),
    }) as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
  });
});
