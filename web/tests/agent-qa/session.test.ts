import { describe, expect, it, vi } from "vitest";
import { resolveSupabaseEnvCore } from "../../../scripts/agent-qa/supabase-env.mjs";
import {
  AGENT_QA_MAGIC_LINK_REDIRECT,
  bootstrapAgentQaFreshSession,
  createAgentQaUser,
  deleteAgentQaUser,
  generateAgentQaMagicLink,
  resolveAgentQaSupabaseEnv,
} from "../../../scripts/agent-qa/session.mjs";
import { AGENT_QA_REGULAR_EMAIL } from "../../../scripts/agent-qa/personas.mjs";

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

describe("resolveSupabaseEnvCore", () => {
  it("resolves URL/anon mirrors and keeps service_role server-side only", () => {
    expect(
      resolveSupabaseEnvCore({
        NEXT_PUBLIC_SUPABASE_URL: "https://staging.supabase.co/",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      }),
    ).toEqual(ENV);
  });

  it("never honors a NEXT_PUBLIC_* service_role mirror", () => {
    expect(() =>
      resolveSupabaseEnvCore({
        SUPABASE_URL: "https://staging.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "leaked",
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("resolveAgentQaSupabaseEnv", () => {
  it("shares the core contract under the agent-QA label", () => {
    expect(
      resolveAgentQaSupabaseEnv({
        SUPABASE_URL: "https://staging.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      }),
    ).toEqual(ENV);
    expect(() => resolveAgentQaSupabaseEnv({})).toThrow(/Agent-QA Supabase/);
  });
});

describe("generateAgentQaMagicLink (mocked Admin API)", () => {
  it("returns the action link untouched — never the service_role key", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        properties: { action_link: "https://staging.supabase.co/auth/v1/verify?token=abc" },
      }),
    );
    const url = await generateAgentQaMagicLink(ENV, "agent-qa-fresh-r1@coffeemode.test", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(url).toBe("https://staging.supabase.co/auth/v1/verify?token=abc");
    expect(url).not.toContain("service-role-key");
    const [linkUrl, linkInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(linkUrl).toBe("https://staging.supabase.co/auth/v1/admin/generate_link");
    expect((linkInit.headers as Record<string, string>).authorization).toBe(
      "Bearer service-role-key",
    );
    const body = JSON.parse(linkInit.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "magiclink",
      email: "agent-qa-fresh-r1@coffeemode.test",
      options: { redirect_to: AGENT_QA_MAGIC_LINK_REDIRECT },
    });
  });

  it("refuses a redirect_to outside the allowlist before any network call", async () => {
    const fetchImpl = vi.fn();
    await expect(
      generateAgentQaMagicLink(ENV, "agent-qa-fresh-r1@coffeemode.test", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        redirectTo: "https://cafemood.app/auth/callback",
      }),
    ).rejects.toThrow(/outside the staging allowlist/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws without a user id or action link in the response", async () => {
    const noUser = vi.fn().mockResolvedValueOnce(jsonResponse(200, {}));
    await expect(
      createAgentQaUser(ENV, "agent-qa-fresh-r1@coffeemode.test", {
        fetchImpl: noUser as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/no user id/);
    const noLink = vi.fn().mockResolvedValueOnce(jsonResponse(200, { properties: {} }));
    await expect(
      generateAgentQaMagicLink(ENV, "agent-qa-fresh-r1@coffeemode.test", {
        fetchImpl: noLink as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/no action link/);
  });
});

describe("bootstrapAgentQaFreshSession (mocked Admin API)", () => {
  it("creates the user, mints the link, and disposes via Admin API", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: "user-1" } }))
      .mockResolvedValueOnce(jsonResponse(200, { properties: { action_link: "https://x/verify?t=1" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const session = await bootstrapAgentQaFreshSession(ENV, "run1", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(session.userId).toBe("user-1");
    expect(session.email).toBe("agent-qa-fresh-run1@coffeemode.test");
    expect(session.magicLinkUrl).toBe("https://x/verify?t=1");
    const createBody = JSON.parse(fetchImpl.mock.calls[0][1].body as string) as Record<
      string,
      unknown
    >;
    expect(createBody).toMatchObject({ email: session.email, email_confirm: true });
    expect(createBody).not.toHaveProperty("password");
    await session.dispose();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("deletes the orphan user when link generation fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "user-2" }))
      .mockResolvedValueOnce(new Response("bad link", { status: 400 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      bootstrapAgentQaFreshSession(ENV, "run2", { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/generate magic link failed \(HTTP 400\)/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("deleteAgentQaUser", () => {
  it("tolerates 404 so double cleanup stays green", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(
      deleteAgentQaUser(ENV, "gone", { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeUndefined();
  });

  it("refuses the persistent regular persona without touching the network", async () => {
    const fetchImpl = vi.fn();
    await expect(
      deleteAgentQaUser(ENV, "regular-id", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        email: AGENT_QA_REGULAR_EMAIL,
      }),
    ).rejects.toThrow(/persistent persona/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
