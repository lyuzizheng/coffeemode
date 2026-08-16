import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  closePool,
  getPool,
  getPoolConfig,
  registerPoolShutdownHandlers,
  withTransaction,
} from "@/lib/db/postgres";

interface MockPool {
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

function createMockPoolInstance(): MockPool {
  return {
    connect: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  };
}

let currentMockPool: MockPool | undefined;

vi.mock("pg", () => ({
  Pool: function () {
    if (!currentMockPool) throw new Error("No mock pool set for test");
    return currentMockPool;
  },
}));

beforeEach(() => {
  currentMockPool = createMockPoolInstance();
});

afterEach(async () => {
  await closePool();
  currentMockPool = undefined;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_POOL_MAX;
  delete process.env.DATABASE_POOL_IDLE_TIMEOUT_MS;
  delete process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS;
});

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
    ["require", { rejectUnauthorized: true }],
    ["prefer", { rejectUnauthorized: true }],
    ["verify-ca", { rejectUnauthorized: true }],
    ["verify-full", { rejectUnauthorized: true }],
    ["allow-self-signed", { rejectUnauthorized: false }],
    ["disable", false],
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

  it.each(["unknown", "", "REQUIRE"])(
    "fails closed on unrecognized sslmode (%s)",
    (value) => {
      const prev = process.env.DATABASE_URL;
      process.env.DATABASE_URL = `postgres://u:p@localhost/db?sslmode=${value}`;
      try {
        expect(() => getPoolConfig()).toThrow(/Unrecognized sslmode/);
      } finally {
        if (prev === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = prev;
      }
    },
  );

  it("applies pool sizing defaults and environment overrides", () => {
    const prevUrl = process.env.DATABASE_URL;
    const prevMax = process.env.DATABASE_POOL_MAX;
    const prevIdle = process.env.DATABASE_POOL_IDLE_TIMEOUT_MS;
    const prevConn = process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS;

    process.env.DATABASE_URL = "postgres://u:p@localhost/db";
    process.env.DATABASE_POOL_MAX = "5";
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = "1000";
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = "3000";

    try {
      const config = getPoolConfig();
      expect(config.max).toBe(5);
      expect(config.idleTimeoutMillis).toBe(1000);
      expect(config.connectionTimeoutMillis).toBe(3000);
      expect(config.allowExitOnIdle).toBe(false);
    } finally {
      process.env.DATABASE_URL = prevUrl;
      if (prevMax === undefined) delete process.env.DATABASE_POOL_MAX;
      else process.env.DATABASE_POOL_MAX = prevMax;
      if (prevIdle === undefined) delete process.env.DATABASE_POOL_IDLE_TIMEOUT_MS;
      else process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = prevIdle;
      if (prevConn === undefined) delete process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS;
      else process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = prevConn;
    }
  });

  it("falls back to defaults for invalid environment values", () => {
    const prevUrl = process.env.DATABASE_URL;
    const prevMax = process.env.DATABASE_POOL_MAX;

    process.env.DATABASE_URL = "postgres://u:p@localhost/db";
    process.env.DATABASE_POOL_MAX = "not-a-number";

    try {
      const config = getPoolConfig();
      expect(config.max).toBe(20);
    } finally {
      process.env.DATABASE_URL = prevUrl;
      if (prevMax === undefined) delete process.env.DATABASE_POOL_MAX;
      else process.env.DATABASE_POOL_MAX = prevMax;
    }
  });
});

describe("Postgres pool lifecycle", () => {
  it("creates a single shared pool and attaches error handlers", () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost/db";

    const first = getPool();
    const second = getPool();
    expect(first).toBe(second);
    expect(first).toBe(currentMockPool);
    expect(currentMockPool!.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("closes the pool and allows a new one to be created", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost/db";

    const first = getPool();
    await closePool();
    expect(currentMockPool!.end).toHaveBeenCalledOnce();

    currentMockPool = createMockPoolInstance();
    const second = getPool();
    expect(second).not.toBe(first);
  });

  it("makes closePool idempotent", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost/db";

    getPool();
    await closePool();
    await closePool();
    expect(currentMockPool!.end).toHaveBeenCalledOnce();
  });
});

describe("withTransaction", () => {
  it("commits the transaction when the callback succeeds", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost/db";

    const clientQuery = vi.fn();
    const clientRelease = vi.fn();
    currentMockPool!.connect.mockResolvedValue({
      query: clientQuery,
      release: clientRelease,
    });

    clientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    clientQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // user query
    clientQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: number }>("SELECT 1");
      return rows[0];
    });

    expect(result).toEqual({ id: 1 });
    expect(clientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(clientQuery).toHaveBeenNthCalledWith(2, "SELECT 1");
    expect(clientQuery).toHaveBeenNthCalledWith(3, "COMMIT");
    expect(clientRelease).toHaveBeenCalledOnce();
  });

  it("rolls back the transaction when the callback throws", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost/db";

    const clientQuery = vi.fn();
    const clientRelease = vi.fn();
    currentMockPool!.connect.mockResolvedValue({
      query: clientQuery,
      release: clientRelease,
    });

    clientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    clientQuery.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(
      withTransaction(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(clientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(clientQuery).toHaveBeenNthCalledWith(2, "ROLLBACK");
    expect(clientRelease).toHaveBeenCalledOnce();
  });
});

describe("registerPoolShutdownHandlers", () => {
  it("registers process signal handlers exactly once", () => {
    const onSpy = vi.spyOn(process, "on").mockImplementation(() => process);

    registerPoolShutdownHandlers();
    registerPoolShutdownHandlers();

    const sigtermCalls = onSpy.mock.calls.filter(([signal]) => signal === "SIGTERM");
    const sigintCalls = onSpy.mock.calls.filter(([signal]) => signal === "SIGINT");
    expect(sigtermCalls.length).toBe(1);
    expect(sigintCalls.length).toBe(1);

    onSpy.mockRestore();
  });
});
