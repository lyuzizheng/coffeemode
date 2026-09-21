import { describe, expect, it } from "vitest";
import { getViewerIdFromCookies } from "@/lib/auth/viewer-id";

function sessionCookie(session: unknown): string {
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

function jwt(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `header.${payload}.sig`;
}

describe("getViewerIdFromCookies", () => {
  it("returns null with no cookie header", () => {
    expect(getViewerIdFromCookies("")).toBeNull();
    expect(getViewerIdFromCookies("theme=dark; locale=en")).toBeNull();
  });

  it("decodes the base64- @supabase/ssr session cookie", () => {
    const header = `sb-project-auth-token=${sessionCookie({ user: { id: "u-a" }, access_token: "x" })}`;
    expect(getViewerIdFromCookies(header)).toBe("u-a");
  });

  it("decodes a raw JSON session cookie", () => {
    const header = `sb-project-auth-token=${encodeURIComponent(JSON.stringify({ user: { id: "u-b" } }))}`;
    expect(getViewerIdFromCookies(header)).toBe("u-b");
  });

  it("reassembles chunked session cookies in order", () => {
    const full = sessionCookie({ user: { id: "u-chunked" } });
    const mid = Math.floor(full.length / 2);
    const header = `sb-project-auth-token.0=${full.slice(0, mid)}; sb-project-auth-token.1=${full.slice(mid)}`;
    expect(getViewerIdFromCookies(header)).toBe("u-chunked");
  });

  it("falls back to the access_token sub when user is absent", () => {
    const header = `sb-project-auth-token=${sessionCookie({ access_token: jwt("u-sub") })}`;
    expect(getViewerIdFromCookies(header)).toBe("u-sub");
  });

  it("reads a bare JWT from the legacy sb-access-token cookie", () => {
    expect(getViewerIdFromCookies(`sb-access-token=${jwt("u-legacy")}`)).toBe("u-legacy");
  });

  it("returns null for malformed session values", () => {
    expect(getViewerIdFromCookies("sb-project-auth-token=not-json-not-jwt")).toBeNull();
    expect(getViewerIdFromCookies("sb-project-auth-token=base64-!!!")).toBeNull();
    expect(
      getViewerIdFromCookies(`sb-project-auth-token=${sessionCookie({ user: {} })}`),
    ).toBeNull();
  });
});
