import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { requireSameOrigin } from "@/lib/security/origin";
import { decodeFakeJwt } from "./auth";
import {
  apiClient,
  buildRouteRequest,
  createHttpTestUsers,
  HTTP_USER_IDS,
  parseRouteResponse,
  resetRateLimits,
  routeParams,
  seedHttpTestUsers,
  setCurrentTestUser,
  TEST_ORIGIN,
  type HttpTestUsers,
} from "./http-client";
import { createTestSessionUser } from "./mocks";

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(),
}));

/** Echo handler: proves identity resolution + origin pass-through end to end. */
async function echoHandler(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    userId: user.id,
    method: request.method,
    authHeader: request.headers.get("authorization"),
  });
}

async function conflictHandler(): Promise<Response> {
  return NextResponse.json({ error: "duplicate", existing_checkin_id: "checkin-1" }, { status: 409 });
}

describe("http-client harness", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
  });

  it("builds canonical requests with origin, JSON type, and encoded query", () => {
    const request = buildRouteRequest("GET", "/api/cafes", {
      query: { lat: 1.3, lng: 103.8, q: "blue bottle" },
    });
    expect(request.url).toBe(`${TEST_ORIGIN}/api/cafes?lat=1.3&lng=103.8&q=blue+bottle`);
    expect(request.headers.get("origin")).toBe("http://localhost:3000");
    expect(request.method).toBe("GET");
  });

  it("serializes JSON bodies with content-type", async () => {
    const request = buildRouteRequest("POST", "/api/checkins", { body: { cafe_id: "c1" } });
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(await request.json()).toEqual({ cafe_id: "c1" });
  });

  it("resolves getCurrentUser to the client session and switches identity", async () => {
    const users = createHttpTestUsers();
    const client = apiClient(users.userA);

    const asA = await client.get<{ userId: string }>(echoHandler, "/api/profile");
    expect(asA.status).toBe(200);
    expect(asA.data.userId).toBe(users.userA.id);

    client.withSession(users.userB);
    const asB = await client.get<{ userId: string }>(echoHandler, "/api/profile");
    expect(asB.data.userId).toBe(users.userB.id);

    const override = await client.get<{ userId: string }>(echoHandler, "/api/profile", {
      session: users.userC,
    });
    expect(override.data.userId).toBe(users.userC.id);
    // Per-call override does not leak into the client session.
    expect(client.session?.id).toBe(users.userB.id);
  });

  it("runs unauthenticated as guest and preserves 401", async () => {
    const users = createHttpTestUsers();
    const guest = apiClient();
    const res = await guest.get<{ error: string }>(echoHandler, "/api/profile");
    expect(res.status).toBe(401);
    expect(res.data).toEqual({ error: "unauthorized" });

    const switched = apiClient(users.userA).asGuest();
    expect(switched.session).toBeNull();
    expect((await switched.get(echoHandler, "/api/profile")).status).toBe(401);
  });

  it("sends post/patch/delete bodies through to the handler", async () => {
    async function bodyEcho(request: Request): Promise<Response> {
      return NextResponse.json({ method: request.method, body: await request.json() });
    }
    const client = apiClient();
    expect((await client.post(bodyEcho, "/api/x", { v: 1 })).data).toEqual({
      method: "POST",
      body: { v: 1 },
    });
    expect((await client.patch(bodyEcho, "/api/x", { v: 2 })).data).toEqual({
      method: "PATCH",
      body: { v: 2 },
    });
    expect((await client.delete(bodyEcho, "/api/x", { confirm: true })).data).toEqual({
      method: "DELETE",
      body: { confirm: true },
    });
  });

  it("builds NextRequests accepted by NextRequest-typed handlers", async () => {
    // Mirrors the 6 `NextRequest`-typed app/api handlers (e.g. PATCH
   // /api/profile/identity): must typecheck AND run without casts.
    async function nextHandler(request: NextRequest): Promise<Response> {
      return NextResponse.json({ nextUrl: request.nextUrl.pathname, method: request.method });
    }
    const built = buildRouteRequest("GET", "/api/profile");
    expect(built).toBeInstanceOf(NextRequest);
    const res = await apiClient().get(nextHandler, "/api/profile");
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ nextUrl: "/api/profile", method: "GET" });
  });

  it("preserves real HTTP error codes and bodies", async () => {
    const res = await apiClient(createHttpTestUsers().userA).post<{
      error: string;
      existing_checkin_id: string;
    }>(conflictHandler, "/api/checkins", {});
    expect(res.status).toBe(409);
    expect(res.data).toEqual({ error: "duplicate", existing_checkin_id: "checkin-1" });
  });

  it("passes dynamic-segment ctx through to handlers", async () => {
    async function likeHandler(
      _request: Request,
      { params }: { params: Promise<{ id: string }> },
    ): Promise<Response> {
      return NextResponse.json({ id: (await params).id });
    }
    const res = await apiClient().call(likeHandler, "POST", "/api/checkins/c1/like", {}, routeParams({ id: "c1" }));
    expect(res.data).toEqual({ id: "c1" });
  });

  it("parses empty and non-JSON responses without throwing", async () => {
    expect((await parseRouteResponse(new Response(null, { status: 204 }))).data).toBeNull();
    const text = await parseRouteResponse<string>(new Response("plain", { status: 200 }));
    expect(text.data).toBe("plain");
  });

  it("setCurrentTestUser programs the mock directly", async () => {
    const users = createHttpTestUsers();
    setCurrentTestUser(users.userD);
    expect(await getCurrentUser()).toEqual({ id: users.userD.id });
    setCurrentTestUser(null);
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("http multi-user environment", () => {
  it("provides four distinct users with matching JWTs", () => {
    const users = createHttpTestUsers();
    const all = [users.userA, users.userB, users.userC, users.userD];
    expect(new Set(all.map((user) => user.id)).size).toBe(4);
    expect(users.userA.id).toBe(HTTP_USER_IDS.A);
    for (const user of all) {
      expect(decodeFakeJwt(user.jwt)).toMatchObject({ sub: user.id, role: "authenticated" });
    }
    expect(users.userA.currentCity).toBe("singapore");
    expect(users.userC.currentCity).toBe("tokyo");
  });

  it("seeds one profile row per user with upsert semantics", async () => {
    const users: HttpTestUsers = createHttpTestUsers();
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const dbClient = {
      query: async (text: string, values: unknown[]) => {
        queries.push({ text, values });
        return { rows: [] };
      },
    } as never as pg.Client;

    await seedHttpTestUsers(dbClient, users);

    expect(queries).toHaveLength(4);
    expect(queries[0].values).toEqual([users.userA.id, users.userA.displayName, users.userA.currentCity]);
    for (const query of queries) {
      expect(query.text).toContain("on conflict (id) do update");
    }
  });

  it("seeds extra slice-local personas through the same upsert", async () => {
    const users: HttpTestUsers = createHttpTestUsers();
    const extra = createTestSessionUser({ id: "c0000000-0000-4000-a000-0000000000a5" });
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const dbClient = {
      query: async (text: string, values: unknown[]) => {
        queries.push({ text, values });
        return { rows: [] };
      },
    } as never as pg.Client;

    await seedHttpTestUsers(dbClient, users, [extra]);

    expect(queries).toHaveLength(5);
    expect(queries[4].values?.[0]).toBe(extra.id);
  });

  it("resets rate limits with a plain delete", async () => {
    const queries: string[] = [];
    const dbClient = {
      query: async (text: string) => {
        queries.push(text);
        return { rows: [] };
      },
    } as never as pg.Client;

    await resetRateLimits(dbClient);

    expect(queries).toEqual(["delete from rate_limits"]);
  });
});
