import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECK_SQL, PostgresRateLimiter, mapBucketRow } from "@/lib/rate-limit/postgres";
import { createRateLimiter, RateLimiter } from "@/lib/rate-limit";

/** Minimal pg-shaped fake: returns one row per check call. */
function fakeQuery(rows: Array<Record<string, unknown>>) {
  return vi.fn().mockResolvedValue({ rows });
}

describe("mapBucketRow", () => {
  it("maps a fresh bucket to an allowed result", () => {
    const now = 1_000_000;
    const result = mapBucketRow(
      { tokens: 4, reset_at: new Date(now + 60_000) },
      now,
    );
    expect(result).toEqual({
      allowed: true,
      remaining: 4,
      resetAt: now + 60_000,
      retryAfter: 60,
    });
  });

  it("blocks when tokens went negative and reports Retry-After", () => {
    const now = 1_000_000;
    const result = mapBucketRow(
      { tokens: -1, reset_at: new Date(now + 5_000) },
      now,
    );
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBe(5);
  });

  it("accepts numeric timestamps (non-Date driver rows)", () => {
    const result = mapBucketRow({ tokens: 1, reset_at: 2_000_000 }, 1_000_000);
    expect(result.allowed).toBe(true);
    expect(result.resetAt).toBe(2_000_000);
  });
});

describe("PostgresRateLimiter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues the atomic CHECK_SQL with key, window and max", async () => {
    const run = fakeQuery([{ tokens: 4, reset_at: new Date(60_000) }]);
    const limiter = new PostgresRateLimiter(run, () => 0);

    const result = await limiter.check("images:user:1", 60_000, 5);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    // First call is always a check (cleanup is throttled by interval).
    expect(run).toHaveBeenCalledWith(CHECK_SQL, ["images:user:1", 60_000, 5]);
  });

  it("fails open (allows) when the database is unavailable", async () => {
    const run = vi.fn().mockRejectedValue(new Error("db down"));
    const limiter = new PostgresRateLimiter(run, () => 0);

    const result = await limiter.check("key", 60_000, 5);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("fails open when the query returns no row", async () => {
    const run = fakeQuery([]);
    const limiter = new PostgresRateLimiter(run, () => 0);
    expect((await limiter.check("key", 60_000, 5)).allowed).toBe(true);
  });

  it("runs an opportunistic cleanup DELETE once per minute", async () => {
    let now = 0;
    const run = fakeQuery([{ tokens: 1, reset_at: new Date(60_000) }]);
    const limiter = new PostgresRateLimiter(run, () => now);

    await limiter.check("a", 60_000, 2);
    expect(run).toHaveBeenCalledTimes(1); // cleanup interval not yet reached

    now = 61_000;
    await limiter.check("b", 60_000, 2);
    expect(run).toHaveBeenCalledTimes(3); // cleanup DELETE + check
    expect(run.mock.calls[1][0]).toContain("DELETE FROM rate_limits");
  });

  it("reset() deletes all buckets", async () => {
    const run = vi.fn().mockResolvedValue({ rows: [] });
    const limiter = new PostgresRateLimiter(run, () => 0);
    await limiter.reset();
    expect(run).toHaveBeenCalledWith("DELETE FROM rate_limits");
  });
});

describe("createRateLimiter backend selection", () => {
  const originalBackend = process.env.RATE_LIMIT_BACKEND;
  const originalDbUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalBackend === undefined) delete process.env.RATE_LIMIT_BACKEND;
    else process.env.RATE_LIMIT_BACKEND = originalBackend;
    if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDbUrl;
  });

  it("uses the Postgres backend when RATE_LIMIT_BACKEND=postgres", async () => {
    process.env.RATE_LIMIT_BACKEND = "postgres";
    expect(await createRateLimiter()).toBeInstanceOf(PostgresRateLimiter);
  });

  it("uses Postgres by default when DATABASE_URL is set", async () => {
    delete process.env.RATE_LIMIT_BACKEND;
    process.env.DATABASE_URL = "postgres://user:pass@localhost/db";
    expect(await createRateLimiter()).toBeInstanceOf(PostgresRateLimiter);
  });

  it("falls back to memory when DATABASE_URL is unset (dev/tests/CI)", async () => {
    delete process.env.RATE_LIMIT_BACKEND;
    delete process.env.DATABASE_URL;
    expect(await createRateLimiter()).toBeInstanceOf(RateLimiter);
  });
});
