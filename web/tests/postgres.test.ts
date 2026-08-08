import { describe, expect, it, vi } from "vitest";
import { getPoolConfig } from "@/lib/db/postgres";

describe("Postgres pool config", () => {
  it("throws a configuration error when DATABASE_URL is missing", () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => getPoolConfig()).toThrow(/DATABASE_URL is not set/);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });

  it.each([
    ["require", { rejectUnauthorized: false }],
    ["prefer", { rejectUnauthorized: false }],
    ["disable", false],
    ["verify-ca", true],
    ["verify-full", true],
  ] as const)("maps sslmode=%s to ssl=%o", (sslmode, expectedSsl) => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `postgres://u:p@localhost/db?sslmode=${sslmode}`;
    try {
      const config = getPoolConfig();
      expect(config.connectionString).toBe("postgres://u:p@localhost/db");
      expect(config.ssl).toEqual(expectedSsl);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  it("warns on unrecognized sslmode and leaves ssl unset", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://u:p@localhost/db?sslmode=unknown";
    try {
      const config = getPoolConfig();
      expect(config.connectionString).toBe("postgres://u:p@localhost/db");
      expect(config).not.toHaveProperty("ssl");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknown"));
    } finally {
      warnSpy.mockRestore();
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});
