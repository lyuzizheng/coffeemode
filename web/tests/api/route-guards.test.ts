import { describe, it, expect } from "vitest";
import { checkRouteGuards } from "../../scripts/check-route-guards.mjs";
import { resolve, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("Route guard enforcement (BRAWUKA-181 / B-STD-2, BRAWUKA-537)", () => {
  const webRoot = resolve(process.cwd());
  it("exports checkRouteGuards function", () => {
    expect(typeof checkRouteGuards).toBe("function");
  });
  it("verifies all current API routes are wrapped in apiRoute() with no violations", () => {
    const violations = checkRouteGuards(webRoot);
    expect(violations).toEqual([]);
  });
  it("flags a mutating route exported as a bare function", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "guard-test-"));
    try {
      const apiDir = join(tempDir, "app", "api", "test-mutating");
      mkdirSync(apiDir, { recursive: true });
      writeFileSync(
        join(apiDir, "route.ts"),
        `import { apiRoute } from "@/lib/api/route";\nexport async function POST() { return new Response(); }`,
      );
      const violations = checkRouteGuards(tempDir);
      expect(violations).toContainEqual(
        expect.objectContaining({
          method: "POST",
          reason: expect.stringContaining("apiRoute"),
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
  it("flags a mutating apiRoute() export missing origin: true", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "guard-test-"));
    try {
      const apiDir = join(tempDir, "app", "api", "test-mutating");
      mkdirSync(apiDir, { recursive: true });
      writeFileSync(
        join(apiDir, "route.ts"),
        `import { apiRoute } from "@/lib/api/route";\nexport const POST = apiRoute({ bucket: "cafes-write", route: "POST /x" }, async () => new Response());`,
      );
      const violations = checkRouteGuards(tempDir);
      expect(violations).toContainEqual(
        expect.objectContaining({
          method: "POST",
          reason: expect.stringContaining("origin"),
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
  it("flags direct guard()/requireSameOrigin() calls inside a route file", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "guard-test-"));
    try {
      const apiDir = join(tempDir, "app", "api", "test-direct");
      mkdirSync(apiDir, { recursive: true });
      writeFileSync(
        join(apiDir, "route.ts"),
        `import { apiRoute } from "@/lib/api/route";\nimport { guard } from "@/lib/api/guard";\nexport const GET = apiRoute({ bucket: "cafes-read", route: "GET /x" }, async (req) => { await guard(req, { bucket: "cafes-read" }); return new Response(); });`,
      );
      const violations = checkRouteGuards(tempDir);
      expect(violations).toContainEqual(
        expect.objectContaining({
          reason: expect.stringContaining("guard()"),
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
