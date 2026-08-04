import { describe, expect, it } from "vitest";

describe("Neon pool guard", () => {
  it("throws a configuration error when DATABASE_URL is missing", async () => {
    // Import lazily so the env mutation below is in effect first.
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { getPool } = await import("@/lib/db/neon");
      expect(() => getPool()).toThrow(/DATABASE_URL is not set/);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });
});
