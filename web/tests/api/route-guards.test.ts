import { describe, it, expect } from "vitest";
import { checkRouteGuards } from "../../scripts/check-route-guards.mjs";
import { resolve, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("Route guard enforcement (BRAWUKA-181 / B-STD-2)", () => {
  const webRoot = resolve(process.cwd());
  it("exports checkRouteGuards function", () => {
    expect(typeof checkRouteGuards).toBe("function");
  });
  it("verifies all current API routes properly invoke guard() with no violations", () => {
    const violations = checkRouteGuards(webRoot);
    expect(violations).toEqual([]);
  });
  it("flags mutating routes that omit requireSameOrigin", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "guard-test-"));
    try {
      const apiDir = join(tempDir, "app", "api", "test-mutating");
      mkdirSync(apiDir, { recursive: true });
      writeFileSync(
        join(apiDir, "route.ts"),
        `import { guard } from "@/lib/api/guard";\nexport async function POST() { guard(); }`,
      );
      const violations = checkRouteGuards(tempDir);
      expect(violations).toContainEqual(
        expect.objectContaining({
          method: "POST",
          reason: expect.stringContaining("requireSameOrigin"),
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
