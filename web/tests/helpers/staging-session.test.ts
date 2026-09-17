import { describe, expect, it, vi } from "vitest";
import {
  createStagingTestSession,
  deleteStagingTestUser,
  resolveStagingSessionEnv,
} from "./staging-session";

const ENV = {
  supabaseUrl: "https://staging.supabase.co",
  anonKey: "anon-key",
  serviceRoleKey: "service-role-key",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("resolveStagingSessionEnv", () => {
  it("resolves URL/anon mirrors and keeps service_role server-side only", () => {
    const resolved = resolveStagingSessionEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://staging.supabase.co/",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    });
    expect(resolved).toEqual(ENV);
  });

  it("prefers the server-side SUPABASE_* names and strips trailing slashes", () => {
    const resolved = resolveStagingSessionEnv({
      SUPABASE_URL: "https://staging.supabase.co///",
      NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "other-anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    });
    expect(resolved.supabaseUrl).toBe("https://staging.supabase.co");
    expect(resolved.anonKey).toBe("anon-key");
  });

  it("throws listing every missing variable, with no defaults", () => {
    expect(() => resolveStagingSessionEnv({})).toThrow(
      /SUPABASE_URL[\s\S]*SUPABASE_ANON_KEY[\s\S]*SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("rejects a NEXT_PUBLIC_* service_role key (server-side only)", () => {
    expect(() =>
      resolveStagingSessionEnv({
        SUPABASE_URL: "https://staging.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "leaked",
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("createStagingTestSession (mocked Supabase boundary)", () => {
  it("creates the user via Admin API, signs in via password grant, disposes via Admin API", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: "user-1" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const session = await createStagingTestSession(ENV, { fetchImpl });

    expect(session.userId).toBe("user-1");
    expect(session.email).toMatch(/^staging-journey\+[0-9a-f]{32}@coffeemode\.test$/);
    expect(session.accessToken).toBe("access-1");
    expect(session.refreshToken).toBe("refresh-1");

    const [createUrl, createInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe("https://staging.supabase.co/auth/v1/admin/users");
    expect(createInit.method).toBe("POST");
    const createHeaders = createInit.headers as Record<string, string>;
    expect(createHeaders.apikey).toBe("service-role-key");
    expect(createHeaders.authorization).toBe("Bearer service-role-key");
    const createBody = JSON.parse(createInit.body as string) as Record<string, unknown>;
    expect(createBody).toMatchObject({ email: session.email, email_confirm: true });
    expect(typeof createBody.password).toBe("string");

    const [grantUrl, grantInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(grantUrl).toBe("https://staging.supabase.co/auth/v1/token?grant_type=password");
    const grantHeaders = grantInit.headers as Record<string, string>;
    expect(grantHeaders.apikey).toBe("anon-key");
    expect(grantHeaders).not.toHaveProperty("authorization");
    const grantBody = JSON.parse(grantInit.body as string) as Record<string, unknown>;
    expect(grantBody).toMatchObject({ email: session.email });
    expect(String(grantBody.password)).toContain("-");

    await session.dispose();
    const [deleteUrl, deleteInit] = fetchImpl.mock.calls[2] as [string, RequestInit];
    expect(deleteUrl).toBe("https://staging.supabase.co/auth/v1/admin/users/user-1");
    expect(deleteInit.method).toBe("DELETE");
    expect((deleteInit.headers as Record<string, string>).authorization).toBe("Bearer service-role-key");
  });

  it("throws without creating a session when Admin user creation fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    await expect(createStagingTestSession(ENV, { fetchImpl })).rejects.toThrow(
      /create user failed \(HTTP 403\)/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws when the password grant fails after the user exists", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "user-2" }))
      .mockResolvedValueOnce(new Response("bad login", { status: 400 }));
    await expect(createStagingTestSession(ENV, { fetchImpl })).rejects.toThrow(
      /password grant failed \(HTTP 400\)/,
    );
  });

  it("throws when the password grant returns no access token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "user-3" }))
      .mockResolvedValueOnce(jsonResponse(200, { refresh_token: "only-refresh" }));
    await expect(createStagingTestSession(ENV, { fetchImpl })).rejects.toThrow(/no access token/);
  });

  it("honors an explicit email prefix and password", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "user-4" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "access-4" }));
    const session = await createStagingTestSession(ENV, {
      fetchImpl,
      emailPrefix: "journey-http",
      password: "fixed-secret",
    });
    expect(session.email.startsWith("journey-http+")).toBe(true);
    const grantBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string) as Record<string, unknown>;
    expect(grantBody.password).toBe("fixed-secret");
    expect(session.refreshToken).toBeNull();
  });
});

describe("deleteStagingTestUser", () => {
  it("tolerates 404 so afterAll stays green on double delete", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(deleteStagingTestUser(ENV, "gone-user", fetchImpl)).resolves.toBeUndefined();
  });

  it("surfaces a non-404 delete failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(deleteStagingTestUser(ENV, "user-9", fetchImpl)).rejects.toThrow(
      /delete user failed \(HTTP 500\)/,
    );
  });
});
