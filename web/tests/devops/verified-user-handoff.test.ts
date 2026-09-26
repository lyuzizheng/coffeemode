import { describe, expect, it } from "vitest";
import {
  VERIFIED_USER_HEADER,
  decodeVerifiedUser,
  encodeVerifiedUser,
  stripInboundVerifiedUser,
  trySetVerifiedUserHeader,
} from "../../lib/auth/verified-user";

/**
 * Proxy → page verified-user handoff (BRAWUKA-723): the transport must be
 * ASCII-safe and bounded. Every case below goes through a real `Headers`
 * instance — exactly the boundary that threw `TypeError: Cannot convert
 * argument to a ByteString` for Chinese and emoji provider names.
 */

const ID = "123e4567-e89b-12d3-a456-426614174000";
function roundTrip(user: Parameters<typeof encodeVerifiedUser>[0]) {
  const headers = new Headers();
  // Must never throw: forwardVerifiedUser runs outside the getUser try/catch,
  // so a throw here is a 500 before the cafe page renders.
  expect(() => headers.set(VERIFIED_USER_HEADER, encodeVerifiedUser(user))).not.toThrow();
  return decodeVerifiedUser(headers.get(VERIFIED_USER_HEADER));
}

describe("verified-user handoff transport (BRAWUKA-723)", () => {
  it("round-trips an ASCII identity through a real header", () => {
    const decoded = roundTrip({
      id: ID,
      email: "alice@example.com",
      user_metadata: { full_name: "Alice" },
    });
    expect(decoded).toEqual({
      id: ID,
      email: "alice@example.com",
      user_metadata: { full_name: "Alice" },
    });
  });

  it("round-trips a Chinese provider name without throwing", () => {
    const decoded = roundTrip({
      id: ID,
      email: "liming@example.com",
      user_metadata: { full_name: "李明" },
    });
    expect(decoded).toMatchObject({
      id: ID,
      user_metadata: { full_name: "李明" },
    });
  });

  it("round-trips an emoji provider name without throwing", () => {
    const decoded = roundTrip({
      id: ID,
      user_metadata: { name: "☕ Nomad" },
    });
    expect(decoded).toMatchObject({
      id: ID,
      user_metadata: { name: "☕ Nomad" },
    });
  });

  it("preserves the display-name fallback candidate chain", () => {
    // loadMapSession falls back to profileFromUser(user) when the DB profile
    // is missing; the first non-empty candidate must survive the handoff.
    const decoded = roundTrip({
      id: ID,
      user_metadata: { full_name: "王芳", name: "☕ Nomad" },
    });
    expect(decoded).toMatchObject({ user_metadata: { full_name: "王芳" } });
    const fallbackOnly = roundTrip({
      id: ID,
      email: "nomad@example.com",
      user_metadata: { preferred_username: " coffee李 " },
    });
    expect(fallbackOnly).toMatchObject({
      user_metadata: { preferred_username: " coffee李 " },
    });
  });

  it("bounds an adversarial display name instead of throwing", () => {
    const decoded = roundTrip({
      id: ID,
      user_metadata: { full_name: "李".repeat(500) },
    });
    expect(decoded).toMatchObject({ id: ID });
    const fullName: unknown = decoded?.user_metadata?.full_name;
    expect(typeof fullName).toBe("string");
    if (typeof fullName === "string") {
      expect(fullName.length).toBeLessThanOrEqual(128);
      expect(fullName.startsWith("李李")).toBe(true);
    }
  });

  it("forwards only the display-relevant metadata allowlist", () => {
    const decoded = roundTrip({
      id: ID,
      email: "a@example.com",
      user_metadata: {
        full_name: "李明",
        avatar_url: "https://lh3.googleusercontent.com/a/avatar",
        phone: "+86-138-0000-0000",
        provider_token: "secret",
        custom_claim: { nested: true },
      },
    });
    expect(decoded).toEqual({
      id: ID,
      email: "a@example.com",
      user_metadata: {
        full_name: "李明",
        avatar_url: "https://lh3.googleusercontent.com/a/avatar",
      },
    });
  });

  it("drops non-string metadata values and over-long avatar URLs", () => {
    const decoded = roundTrip({
      id: ID,
      user_metadata: {
        full_name: 123 as unknown as string,
        avatar_url: `https://example.com/${"a".repeat(3000)}`,
      },
    });
    expect(decoded).toMatchObject({ id: ID });
    expect(decoded?.user_metadata?.full_name).toBeUndefined();
    expect(decoded?.user_metadata?.avatar_url).toBeUndefined();
  });

  it("round-trips a verified-anonymous result", () => {
    expect(encodeVerifiedUser(null)).toBe("null");
    const headers = new Headers();
    headers.set(VERIFIED_USER_HEADER, encodeVerifiedUser(null));
    expect(decodeVerifiedUser(headers.get(VERIFIED_USER_HEADER))).toBeNull();
  });

  it("treats absent and malformed headers as not-verified", () => {
    expect(decodeVerifiedUser(null)).toBeUndefined();
    for (const raw of [
      "",
      "!!!",
      "null ",
      '{"id":"abc"}', // legacy raw-JSON wire format: never trusted, fall back
      encodeVerifiedUser({ id: ID }).slice(0, 8), // truncated payload
      Buffer.from(JSON.stringify({ email: "a@x.com" }), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ id: 123 }), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ id: "" }), "utf8").toString("base64url"),
    ]) {
      expect(decodeVerifiedUser(raw)).toBeUndefined();
    }
  });

  it("strips a client-supplied header so it can never authorize", () => {
    const attackerValue = encodeVerifiedUser({
      id: "00000000-0000-0000-0000-000000000000",
      user_metadata: { full_name: "Attacker" },
    });
    const headers = new Headers({ [VERIFIED_USER_HEADER]: attackerValue });
    stripInboundVerifiedUser(headers);
    expect(headers.get(VERIFIED_USER_HEADER)).toBeNull();
    expect(decodeVerifiedUser(headers.get(VERIFIED_USER_HEADER))).toBeUndefined();
  });

  it("refuses an unencodable identity instead of throwing", () => {
    const headers = new Headers();
    const ok = trySetVerifiedUserHeader(headers, {
      id: "x".repeat(500),
      user_metadata: { full_name: "李明" },
    });
    expect(ok).toBe(false);
    expect(headers.get(VERIFIED_USER_HEADER)).toBeNull();
  });

  it("sets a settable value through the forward helper", () => {
    const headers = new Headers();
    expect(
      trySetVerifiedUserHeader(headers, {
        id: ID,
        user_metadata: { full_name: "李明 ☕" },
      }),
    ).toBe(true);
    expect(decodeVerifiedUser(headers.get(VERIFIED_USER_HEADER))).toMatchObject({ id: ID });
  });
});
