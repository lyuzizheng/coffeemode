import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const appDir = resolve(process.cwd(), "app");

/**
 * DG19 structural invariant (BRAWUKA-658): /cafes/[id] commits its real 404
 * from generateMetadata()'s notFound(), which only works while NO loading
 * boundary wraps the route — a loading.tsx above it streams a 200 shell
 * before metadata resolves, demoting every gone cafe to a soft-404.
 *
 * The map-home skeleton survives, scoped to `/` by the (home) route group.
 * This test fails if a loading boundary reappears above /cafes/[id] or the
 * segment not-found surface is removed.
 */
describe("gone-cafe 404 structure (DG19)", () => {
  it("no loading boundary wraps /cafes/[id]", () => {
    for (const rel of [
      "loading.tsx",
      "cafes/loading.tsx",
      "cafes/[id]/loading.tsx",
    ]) {
      expect(
        existsSync(resolve(appDir, rel)),
        `${rel} would stream a 200 shell before notFound() — soft-404 regression`,
      ).toBe(false);
    }
  });

  it("the map-home skeleton stays scoped to / inside (home)", () => {
    expect(existsSync(resolve(appDir, "(home)/loading.tsx"))).toBe(true);
    expect(existsSync(resolve(appDir, "(home)/page.tsx"))).toBe(true);
  });

  it("the segment not-found surface exists for /cafes/[id]", () => {
    expect(existsSync(resolve(appDir, "cafes/[id]/not-found.tsx"))).toBe(true);
  });
});
