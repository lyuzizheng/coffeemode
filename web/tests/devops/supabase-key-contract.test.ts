import { describe, expect, it } from "vitest";
import { adminHeaders } from "../../../scripts/agent-qa/session.mjs";
import { resolveSupabaseEnvCore } from "../../../scripts/agent-qa/supabase-env.mjs";
import {
  resolveSupabasePublishableKey,
  resolveSupabaseSecretKey,
} from "@/lib/auth/supabase-env";

/**
 * BRAWUKA-950: Supabase replaced the JWT `anon` / `service_role` keys with the
 * opaque `sb_publishable_…` / `sb_secret_…` keys. Two contract rules follow:
 *
 *   1. A new-format key travels in `apikey` only. Repeating it as
 *      `authorization: Bearer` makes the platform parse it as a JWT and answer
 *      `Invalid JWT` — so a Bearer copy exists only for a legacy JWT key.
 *   2. Env reads prefer the new names and fall back to the legacy names while
 *      deployments migrate.
 */

const LEGACY_SERVICE_ROLE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl";

describe("Supabase API key contract (BRAWUKA-950)", () => {
  describe("adminHeaders", () => {
    it("sends a secret key as apikey only — never as Bearer", () => {
      const headers = adminHeaders("sb_secret_abc123");

      expect(headers.apikey).toBe("sb_secret_abc123");
      expect(headers).not.toHaveProperty("authorization");
      expect(headers["content-type"]).toBe("application/json");
    });

    it("sends a publishable key as apikey only — never as Bearer", () => {
      const headers = adminHeaders("sb_publishable_abc123");

      expect(headers.apikey).toBe("sb_publishable_abc123");
      expect(headers).not.toHaveProperty("authorization");
    });

    it("keeps the Bearer copy for a legacy JWT service_role key", () => {
      const headers = adminHeaders(LEGACY_SERVICE_ROLE_JWT);

      expect(headers.apikey).toBe(LEGACY_SERVICE_ROLE_JWT);
      expect(headers.authorization).toBe(`Bearer ${LEGACY_SERVICE_ROLE_JWT}`);
    });

    it("omits the JSON content type when the request carries no body", () => {
      const headers = adminHeaders("sb_secret_abc123", { json: false });

      expect(headers).not.toHaveProperty("content-type");
    });
  });

  describe("resolveSupabaseEnvCore", () => {
    const url = "https://ojujmjewtbquiddswyrg.supabase.co";

    it("prefers the new key names over the legacy ones", () => {
      const resolved = resolveSupabaseEnvCore({
        SUPABASE_URL: url,
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_new",
        SUPABASE_ANON_KEY: "legacy-anon",
        SUPABASE_SECRET_KEY: "sb_secret_new",
        SUPABASE_SERVICE_ROLE_KEY: "legacy-service",
      });

      expect(resolved).toEqual({
        supabaseUrl: url,
        publishableKey: "sb_publishable_new",
        secretKey: "sb_secret_new",
      });
    });

    it("falls back to the legacy names while a deployment migrates", () => {
      const resolved = resolveSupabaseEnvCore({
        SUPABASE_URL: url,
        SUPABASE_ANON_KEY: "legacy-anon",
        SUPABASE_SERVICE_ROLE_KEY: "legacy-service",
      });

      expect(resolved.publishableKey).toBe("legacy-anon");
      expect(resolved.secretKey).toBe("legacy-service");
    });

    it("accepts the NEXT_PUBLIC mirrors for the URL and the publishable key", () => {
      const resolved = resolveSupabaseEnvCore({
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public",
        SUPABASE_SECRET_KEY: "sb_secret_new",
      });

      expect(resolved).toEqual({
        supabaseUrl: url,
        publishableKey: "sb_publishable_public",
        secretKey: "sb_secret_new",
      });
    });

    it("names both the new and the legacy variables when a key is missing", () => {
      expect(() => resolveSupabaseEnvCore({ SUPABASE_URL: url })).toThrow(
        /SUPABASE_PUBLISHABLE_KEY .*legacy SUPABASE_ANON_KEY.*SUPABASE_SECRET_KEY .*legacy SUPABASE_SERVICE_ROLE_KEY/,
      );
    });
  });

  describe("web env readers", () => {
    it("reads NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY before the legacy anon key", () => {
      expect(
        resolveSupabasePublishableKey({
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_new",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon",
        }),
      ).toBe("sb_publishable_new");
      expect(
        resolveSupabasePublishableKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon" }),
      ).toBe("legacy-anon");
    });

    it("reads SUPABASE_SECRET_KEY before the legacy service_role key", () => {
      expect(
        resolveSupabaseSecretKey({
          SUPABASE_SECRET_KEY: "sb_secret_new",
          SUPABASE_SERVICE_ROLE_KEY: "legacy-service",
        }),
      ).toBe("sb_secret_new");
      expect(resolveSupabaseSecretKey({ SUPABASE_SERVICE_ROLE_KEY: "legacy-service" })).toBe(
        "legacy-service",
      );
    });
  });
});
