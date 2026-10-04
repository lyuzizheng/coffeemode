/**
 * @vitest-environment node
 * BRAWUKA-808: real Postgres + Node ImageResponse, never a mocked renderer.
 * Failure cases: broken PNG rasterization; names interpreted as SVG, stripped,
 * or entity-decoded; 200-character names; unknown/private cafe disclosure.
 * Benign markup only: this is a regression smoke, not an exploit reproduction.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/cafes/[id]/og-image/route";
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseContext } from "../helpers/db";
import { buildRouteRequest, routeParams } from "../helpers/http-client";

// Direct handler invocation has no Next request cookie scope; guest auth seam only.
vi.mock("@/lib/auth/get-user", () => ({ getCurrentUser: vi.fn(async () => null) }));

const describeIntegration = process.env.RUN_INTEGRATION === "1" ? describe : describe.skip;
let db: TestDatabaseContext | undefined;

async function seedCafe(name: string, visibility = "public"): Promise<string> {
  const id = randomUUID();
  await db!.dbClient.query(
    `insert into cafes (id, name, location, city, visibility)
     values ($1, $2, ST_SetSRID(ST_MakePoint(103.83, 1.30), 4326)::geography, 'singapore', $3)`,
    [id, name, visibility],
  );
  return id;
}

async function responseFor(id: string): Promise<Response> {
  return GET(buildRouteRequest("GET", `/cafes/${id}/og-image`), routeParams({ id }));
}

async function rasterFor(name: string): Promise<Buffer> {
  const response = await responseFor(await seedCafe(name));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  const png = Buffer.from(await response.arrayBuffer());
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const image = sharp(png);
  expect(await image.metadata()).toMatchObject({ format: "png", width: 1200, height: 630 });
  return image.removeAlpha().raw().toBuffer();
}

describeIntegration("cafe social-image consumer boundary", () => {
  beforeAll(async () => {
    db = await setupTestDatabase("coffeemode_test_og", { useTemplate: false });
  }, 120_000);
  afterAll(async () => {
    await teardownTestDatabase(db);
  });

  it("rasterizes the cafe name rather than returning a constant fallback card", async () => {
    const first = await rasterFor("Coffee & Cake");
    const second = await rasterFor("Morning Espresso");
    expect(first.equals(second)).toBe(false);
  });

  it("renders benign SVG markup as name text, not SVG content or stripped text", async () => {
    const plain = await rasterFor("Cafe");
    const markup = await rasterFor('<svg><rect width="1200" height="630" fill="#ff0000"/></svg> Cafe');
    expect(markup.equals(plain)).toBe(false);
    let redPixels = 0;
    for (let offset = 0; offset < markup.length; offset += 3) {
      if (markup[offset] > 240 && markup[offset + 1] < 16 && markup[offset + 2] < 16) redPixels++;
    }
    expect(redPixels).toBe(0);
  });

  it("preserves entity syntax as literal name text", async () => {
    const literal = await rasterFor("Coffee &amp; Cake &lt;3");
    const decoded = await rasterFor("Coffee & Cake <3");
    expect(literal.equals(decoded)).toBe(false);
  });

  it("rasterizes the maximum 200-character name", async () => {
    const long = await rasterFor("Coffee ".repeat(28) + "Cafe");
    const short = await rasterFor("Coffee");
    expect(long.equals(short)).toBe(false);
  });

  it("returns 404 without a social image for invalid, unknown and private cafes", async () => {
    const privateId = await seedCafe("Private cafe", "private");
    for (const id of ["invalid", randomUUID(), privateId]) {
      const response = await responseFor(id);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
  });
});
