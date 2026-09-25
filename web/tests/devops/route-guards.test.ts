import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkRouteFile, checkRouteGuards } from "../../scripts/check-route-guards.mjs";

/**
 * Route-guard self-checks (BRAWUKA-714): the negative cases from the deleted
 * `tests/api/route-guards.test.ts` live here, in the exempt `tests/devops/`
 * family, so the `check-route-guards.mjs` script that `application-static`
 * invokes via `npm run check:guards` stays verified without a unit suite.
 * No temp-dir case touches the network; the repo-wide case scans the real
 * `web/app/api` tree and must stay violation-free.
 */
describe("route-guard script self-checks (BRAWUKA-181 / B-STD-2, BRAWUKA-537, BRAWUKA-595, BRAWUKA-701)", () => {

  it("verifies all current API routes are wrapped in apiRoute() with no violations", () => {
    expect(checkRouteGuards(resolve(process.cwd()))).toEqual([]);
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
      expect(checkRouteGuards(tempDir)).toContainEqual(
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
      expect(checkRouteGuards(tempDir)).toContainEqual(
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
      expect(checkRouteGuards(tempDir)).toContainEqual(
        expect.objectContaining({
          reason: expect.stringContaining("guard()"),
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("flags a mutating route with variable options (apiRoute(opts, handler))", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "guard-test-"));
    try {
      const apiDir = join(tempDir, "app", "api", "test-variable-opts");
      mkdirSync(apiDir, { recursive: true });
      writeFileSync(
        join(apiDir, "route.ts"),
        `import { apiRoute } from "@/lib/api/route";\nconst opts = { bucket: "cafes-write", route: "POST /x", origin: true };\nexport const POST = apiRoute(opts, async () => new Response());`,
      );
      expect(checkRouteGuards(tempDir)).toContainEqual(
        expect.objectContaining({
          method: "POST",
          reason: expect.stringContaining("origin: true"),
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("flags a mutating route with spread options (apiRoute({...defaults, origin: true}, handler))", () => {
    expect(
      checkRouteFile(
        "app/api/test/route.ts",
        `import { apiRoute } from "@/lib/api/route";\nconst defaults = { bucket: "cafes-write" };\nexport const POST = apiRoute({ ...defaults, origin: true }, async () => new Response());`,
      ),
    ).toContainEqual(
      expect.objectContaining({
        method: "POST",
        reason: expect.stringContaining("spread"),
      }),
    );
  });

  it("flags a mutating route with a nested-brace options object missing origin", () => {
    expect(
      checkRouteFile(
        "app/api/test/route.ts",
        `import { apiRoute } from "@/lib/api/route";\nexport const POST = apiRoute(\n  {\n    bucket: "cafes-write",\n    auth: () => {\n      return { ok: true };\n    },\n  },\n  async () => new Response(),\n);`,
      ),
    ).toContainEqual(
      expect.objectContaining({
        method: "POST",
        reason: expect.stringContaining("origin: true"),
      }),
    );
  });

  it("flags a mutating route with nested braces where origin is in a nested object", () => {
    expect(
      checkRouteFile(
        "app/api/test/route.ts",
        `import { apiRoute } from "@/lib/api/route";\nexport const POST = apiRoute(\n  {\n    bucket: "cafes-write",\n    nested: {\n      origin: true,\n    },\n  },\n  async () => new Response(),\n);`,
      ),
    ).toContainEqual(
      expect.objectContaining({
        method: "POST",
        reason: expect.stringContaining("origin: true"),
      }),
    );
  });

  it("allows a mutating route with nested braces when origin: true is present at the top level after nested braces", () => {
    expect(
      checkRouteFile(
        "app/api/test/route.ts",
        `import { apiRoute } from "@/lib/api/route";\nexport const POST = apiRoute(\n  {\n    bucket: "cafes-write",\n    auth: () => {\n      return { ok: true };\n    },\n    origin: true,\n  },\n  async () => new Response(),\n);`,
      ),
    ).toEqual([]);
  });

  it("allows non-mutating routes (GET) without origin: true", () => {
    expect(
      checkRouteFile(
        "app/api/test/route.ts",
        `import { apiRoute } from "@/lib/api/route";\nexport const GET = apiRoute({ bucket: "cafes-read" }, async () => new Response());`,
      ),
    ).toEqual([]);
  });

  it("flags a destructured HTTP-method export (export const { POST } = ...)", () => {
    const inline = checkRouteFile(
      "app/api/test/route.ts",
      `import { apiRoute } from "@/lib/api/route";\nexport const { POST } = { POST: apiRoute({ bucket: "cafes-write", origin: true }, async () => new Response()) };`,
    );
    expect(inline).toContainEqual(
      expect.objectContaining({
        method: "POST",
        reason: expect.stringContaining("apiRoute"),
      }),
    );

    const opaque = checkRouteFile(
      "app/api/test/route.ts",
      `import { apiRoute } from "@/lib/api/route";\nexport const { POST } = handlers;`,
    );
    expect(opaque).toContainEqual(
      expect.objectContaining({
        method: "POST",
        reason: expect.stringContaining("apiRoute"),
      }),
    );

    expect(
      checkRouteFile("app/api/test/route.ts", `export const { notAMethod } = obj;`),
    ).toEqual([]);
  });

  it("flags non-mutating routes (GET) with non-literal options", () => {
    expect(
      checkRouteFile(
        "app/api/test/route.ts",
        `import { apiRoute } from "@/lib/api/route";\nconst opts = { bucket: "cafes-read" };\nexport const GET = apiRoute(opts, async () => new Response());`,
      ),
    ).toContainEqual(
      expect.objectContaining({
        method: "GET",
        reason: expect.stringContaining("inline object literal"),
      }),
    );
  });
});
