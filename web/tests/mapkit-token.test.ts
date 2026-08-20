import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/mapkit-token/route";
import { rateLimiter } from "@/lib/rate-limit";

const ENV_KEYS = [
  "APPLE_MAPKIT_TEAM_ID",
  "APPLE_MAPKIT_KEY_ID",
  "APPLE_MAPKIT_PRIVATE_KEY",
  "APPLE_MAPKIT_ORIGIN",
  "NEXT_PUBLIC_SITE_URL",
] as const;

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

beforeEach(() => {
  rateLimiter.reset();
  for (const key of ENV_KEYS) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/mapkit-token", () => {
  it("returns 503 until Apple MapKit credentials are configured", async () => {
    const response = await GET(new Request("https://coffee.test/api/mapkit-token"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "mapkit_not_configured" });
  });

  it("creates a MapKit JS token with the required claims and P1363 signature", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    vi.stubEnv("APPLE_MAPKIT_TEAM_ID", "TEAM123456");
    vi.stubEnv("APPLE_MAPKIT_KEY_ID", "KEY1234567");
    vi.stubEnv(
      "APPLE_MAPKIT_PRIVATE_KEY",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://coffee.test");

    const response = await GET(new Request("https://coffee.test/api/mapkit-token"));
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    const header = JSON.parse(decodeBase64Url(encodedHeader)) as Record<string, unknown>;
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Record<string, unknown>;

    expect(header).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    expect(payload).toMatchObject({
      iss: "TEAM123456",
      scope: "mapkit_js",
      origin: "https://coffee.test",
    });
    expect(payload.exp as number).toBe((payload.iat as number) + 15 * 60);
    expect(Buffer.from(encodedSignature, "base64url")).toHaveLength(64);

    const verifier = createVerify("SHA256");
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();
    expect(
      verifier.verify(
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(encodedSignature, "base64url"),
      ),
    ).toBe(true);
  });
});
