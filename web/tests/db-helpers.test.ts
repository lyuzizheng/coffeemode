import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  DEFAULT_TEMPLATE_DB_NAME,
  cleanupIntegrationDatabase,
  ensureTemplateDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  quotedIdentifier,
  testDatabaseUrl,
} from "./helpers/db";
import {
  assertSafeSeedTarget,
  connectionTargetUrl,
  databaseNameFromUrl,
  DEFAULT_DB_URL,
  DEV_DATABASE_NAME,
  evaluateRemoteTarget,
  REMOTE_DB_OPT_IN,
  SEED_DEV_DB_OPT_IN,
} from "../scripts/lib/test-db-policy.mjs";
import { getPoolConfig } from "@/lib/db/postgres";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

describe("db test helpers — unit contracts", () => {
  it("exports standard default DB and template names", () => {
    expect(DEFAULT_DB_URL).toBe("postgres://coffeemode:coffeemode@localhost:5432/coffeemode");
    expect(DEFAULT_TEMPLATE_DB_NAME).toBe("coffeemode_test_template");
  });

  it("quotedIdentifier escapes double quotes and wraps in quotes", () => {
    expect(quotedIdentifier("simple")).toBe('"simple"');
    expect(quotedIdentifier('has"quote')).toBe('"has""quote"');
    expect(quotedIdentifier('a"b"c')).toBe('"a""b""c"');
  });

  it("makeTestDbName generates unique names with prefix and pid", () => {
    const name1 = makeTestDbName("myprefix");
    const name2 = makeTestDbName("myprefix");
    expect(name1).toMatch(/^myprefix_\d+_[a-f0-9]{32}$/);
    expect(name2).toMatch(/^myprefix_\d+_[a-f0-9]{32}$/);
    expect(name1).not.toBe(name2);
  });
  it("testDatabaseUrl replaces pathname on admin url", () => {
    const admin = "postgres://user:pass@localhost:5432/coffeemode";
    const testUrl = testDatabaseUrl(admin, "coffeemode_test_123");
    expect(testUrl).toBe("postgres://user:pass@localhost:5432/coffeemode_test_123");
  });

  it("integrationAdminUrl accepts local hosts and defaults", () => {
    const original = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      delete process.env.ALLOW_REMOTE_INTEGRATION_DB;
      expect(integrationAdminUrl()).toBe(DEFAULT_DB_URL);

      process.env.DATABASE_URL = "postgres://coffeemode:coffeemode@127.0.0.1:5432/coffeemode";
      expect(integrationAdminUrl()).toBe(
        "postgres://coffeemode:coffeemode@127.0.0.1:5432/coffeemode",
      );
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    }
  });

  it("integrationAdminUrl rejects non-local host without opt-in flag", () => {
    const original = process.env.DATABASE_URL;
    const originalOptIn = process.env.ALLOW_REMOTE_INTEGRATION_DB;
    try {
      process.env.DATABASE_URL = "postgres://coffeemode:coffeemode@prod.example.com:5432/coffeemode";
      delete process.env.ALLOW_REMOTE_INTEGRATION_DB;
      expect(() => integrationAdminUrl()).toThrow(/non-local host prod\.example\.com/);

      process.env.ALLOW_REMOTE_INTEGRATION_DB = "1";
      expect(integrationAdminUrl()).toBe(
        "postgres://coffeemode:coffeemode@prod.example.com:5432/coffeemode",
      );
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
      if (originalOptIn === undefined) delete process.env.ALLOW_REMOTE_INTEGRATION_DB;
      else process.env.ALLOW_REMOTE_INTEGRATION_DB = originalOptIn;
    }
  });

  it("integrationAdminUrl refuses a connection-string host override even when the URL looks local", () => {
    const original = process.env.DATABASE_URL;
    const originalOptIn = process.env.ALLOW_REMOTE_INTEGRATION_DB;
    try {
      process.env.DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode?host=elsewhere.internal";
      delete process.env.ALLOW_REMOTE_INTEGRATION_DB;
      expect(() => integrationAdminUrl()).toThrow(/connection-string override "host"/);
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
      if (originalOptIn === undefined) delete process.env.ALLOW_REMOTE_INTEGRATION_DB;
      else process.env.ALLOW_REMOTE_INTEGRATION_DB = originalOptIn;
    }
  });
});

describe("test-db policy — adapters", () => {
  it("databaseNameFromUrl reads the path segment, never the whole URL", () => {
    expect(databaseNameFromUrl("postgres://coffeemode:coffeemode@localhost:5432/coffeemode")).toBe("coffeemode");
    expect(databaseNameFromUrl("postgres://u:p@host:5432/mydev?sslmode=require")).toBe("mydev");
    expect(databaseNameFromUrl("postgres://u:p@host:5432/my%20dev")).toBe("my dev");
  });

  it("rejects malformed connection strings instead of reading them as an empty name", () => {
    // Both runtimes share these adapters now: a parse failure is a refusal, so no
    // caller can compare "" against a target list and conclude "not protected".
    expect(() => databaseNameFromUrl("not a url")).toThrow(/not a valid URL/);
    expect(() => databaseNameFromUrl("postgres://u:p@host:5432/coffeemode%zz")).toThrow(
      /invalid escape sequence/,
    );
    expect(() => connectionTargetUrl("")).toThrow(/not a valid URL/);
  });
});

describe("test-db policy — seed targets (BRAWUKA-216)", () => {
  const originalDbUrl = process.env.DATABASE_URL;
  const originalOptIn = process.env[SEED_DEV_DB_OPT_IN];

  afterAll(() => {
    if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDbUrl;
    if (originalOptIn === undefined) delete process.env[SEED_DEV_DB_OPT_IN];
    else process.env[SEED_DEV_DB_OPT_IN] = originalOptIn;
  });

  it("refuses the default dev database and names it in the error", () => {
    delete process.env.DATABASE_URL;
    delete process.env[SEED_DEV_DB_OPT_IN];
    expect(() => assertSafeSeedTarget(DEV_DATABASE_NAME, { seeder: "seedMockDataset" })).toThrow(
      /Refusing seedMockDataset against database "coffeemode"/,
    );
  });

  it("refuses a custom configured dev database by name", () => {
    process.env.DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/mydev";
    delete process.env[SEED_DEV_DB_OPT_IN];
    expect(() => assertSafeSeedTarget("mydev", { seeder: "seedMockDataset" })).toThrow(/against database "mydev"/);
    expect(() => assertSafeSeedTarget("otherdb", { seeder: "seedMockDataset" })).not.toThrow();
  });

  it("keeps the documented dev name protected when DATABASE_URL points elsewhere", () => {
    process.env.DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/mydev";
    delete process.env[SEED_DEV_DB_OPT_IN];
    expect(() => assertSafeSeedTarget("coffeemode", { seeder: "seedMockDataset" })).toThrow(
      /against database "coffeemode"/,
    );
  });

  it("refuses when the target equals the call-time DATABASE_URL: callers pass the pre-overwrite admin URL", () => {
    const testDbUrl = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode_test_1_abc";
    process.env.DATABASE_URL = testDbUrl;
    delete process.env[SEED_DEV_DB_OPT_IN];
    expect(() => assertSafeSeedTarget("coffeemode_test_1_abc", { seeder: "seedMockDataset" })).toThrow(/Refusing/);
    expect(() =>
      assertSafeSeedTarget("coffeemode_test_1_abc", {
        seeder: "seedMockDataset",
        configUrl: "postgres://coffeemode:coffeemode@localhost:5432/coffeemode",
      }),
    ).not.toThrow();
  });

  it("fails closed on an unresolvable target name", () => {
    delete process.env.DATABASE_URL;
    delete process.env[SEED_DEV_DB_OPT_IN];
    expect(() => assertSafeSeedTarget("", { seeder: "seedMockDataset" })).toThrow(/"\(unknown\)"/);
  });

  it("accepts a provisioned scratch name and reports it was not skipped", () => {
    delete process.env.DATABASE_URL;
    delete process.env[SEED_DEV_DB_OPT_IN];
    expect(assertSafeSeedTarget("coffeemode_test_9_def", { seeder: "setupDbFixtures" })).toEqual({
      target: "coffeemode_test_9_def",
      skipped: false,
    });
  });

  it("fails closed when the configured dev URL itself is unreadable", () => {
    process.env.DATABASE_URL = "not a url";
    delete process.env[SEED_DEV_DB_OPT_IN];
    expect(() => assertSafeSeedTarget("coffeemode_test_9_def", { seeder: "seedMockDataset" })).toThrow(
      /not a valid URL/,
    );
  });

  it("ALLOW_SEED_DEV_DB=1 explicitly overrides the refusal", () => {
    delete process.env.DATABASE_URL;
    process.env[SEED_DEV_DB_OPT_IN] = "1";
    expect(assertSafeSeedTarget("coffeemode", { seeder: "seedMockDataset" })).toEqual({
      target: "coffeemode",
      skipped: true,
    });
    delete process.env[SEED_DEV_DB_OPT_IN];
  });
});

describe("test-db policy — connection targets", () => {
  const originalOptIn = process.env[REMOTE_DB_OPT_IN];

  afterAll(() => {
    if (originalOptIn === undefined) delete process.env[REMOTE_DB_OPT_IN];
    else process.env[REMOTE_DB_OPT_IN] = originalOptIn;
  });

  // Caller-by-caller policy table. `integrationAdminUrl` (Vitest) throws on a
  // refusal; `cleanup-stale-test-dbs.mjs` and `clean-dev-fixtures.mjs` print it
  // and exit 1. All three read this one verdict, so the matrix lives here once.
  const CASES: ReadonlyArray<[label: string, url: string, expected: RegExp | null]> = [
    ["local default", "postgres://coffeemode:coffeemode@localhost:5432/coffeemode", null],
    ["127.0.0.1 alias", "postgres://coffeemode:coffeemode@127.0.0.1:5432/coffeemode", null],
    ["IPv6 loopback alias", "postgres://coffeemode:coffeemode@[::1]:5432/coffeemode", null],
    ["empty host (local socket)", "postgres:///coffeemode", null],
    ["non-local host", "postgres://u:p@db.example.com:5432/coffeemode", /non-local host db\.example\.com/],
    [
      "host override on an otherwise local URL",
      "postgres://u:p@localhost:5432/coffeemode?host=db.example.com",
      /connection-string override "host" \(host localhost\)/,
    ],
    [
      "hostaddr override on an otherwise local URL",
      "postgres://u:p@localhost:5432/coffeemode?hostaddr=10.9.9.9",
      /connection-string override "hostaddr"/,
    ],
    [
      "socketPath override on an otherwise local URL",
      "postgres://u:p@localhost:5432/coffeemode?socketPath=/tmp/pg",
      /connection-string override "socketPath"/,
    ],
  ];

  it.each(CASES)("evaluateRemoteTarget: %s", (_label, url, expected) => {
    delete process.env[REMOTE_DB_OPT_IN];
    const { refusal } = evaluateRemoteTarget(url, { action: "stale-DB sweep" });
    if (expected === null) {
      expect(refusal).toBeNull();
    } else {
      expect(refusal).toMatch(expected);
    }
  });

  it("refuses a malformed URL instead of treating it as an unlisted host", () => {
    delete process.env[REMOTE_DB_OPT_IN];
    expect(() => evaluateRemoteTarget("not a url", { action: "stale-DB sweep" })).toThrow(/not a valid URL/);
  });

  it("reports the inspected host so callers can log their real target", () => {
    delete process.env[REMOTE_DB_OPT_IN];
    const local = evaluateRemoteTarget("postgres://u:p@127.0.0.1:5432/coffeemode", { action: "stale-DB sweep" });
    expect(local.hostname).toBe("127.0.0.1");
    expect(local.isLocalHost).toBe(true);
    expect(local.overrideParam).toBeNull();

    const overridden = evaluateRemoteTarget("postgres://u:p@localhost:5432/db?host=elsewhere", {
      action: "stale-DB sweep",
    });
    expect(overridden.hostname).toBe("localhost");
    expect(overridden.overrideParam).toBe("host");
  });

  it("ALLOW_REMOTE_INTEGRATION_DB=1 lifts the refusal without hiding a malformed URL", () => {
    process.env[REMOTE_DB_OPT_IN] = "1";
    expect(evaluateRemoteTarget("postgres://u:p@db.example.com:5432/coffeemode", { action: "stale-DB sweep" }).refusal).toBeNull();
    expect(evaluateRemoteTarget("postgres://u:p@localhost:5432/db?host=elsewhere", { action: "stale-DB sweep" }).refusal).toBeNull();
    expect(() => evaluateRemoteTarget("not a url", { action: "stale-DB sweep" })).toThrow(/not a valid URL/);
    delete process.env[REMOTE_DB_OPT_IN];
  });
});

describeIntegration("db test helpers — real Postgres template pooling", () => {
  const createdDbs = new Set<string>();
  const adminUrl = integrationAdminUrl();

  afterAll(async () => {
    for (const dbName of createdDbs) {
      try {
        await cleanupIntegrationDatabase(adminUrl, dbName);
      } catch {
        // ignore cleanup errors on teardown
      }
    }
  }, 60_000);

  it(
    "ensureTemplateDatabase provisions and migrates the template database",
    async () => {
      const customTemplate = makeTestDbName("coffeemode_tpl_test");
      createdDbs.add(customTemplate);
      await ensureTemplateDatabase(adminUrl, customTemplate);
      const templateClient = new pg.Client(
        getPoolConfig(testDatabaseUrl(adminUrl, customTemplate)),
      );
      await templateClient.connect();
      try {
        const res = await templateClient.query<{ count: string }>(
          "select count(*)::text from schema_migrations",
        );
        expect(Number.parseInt(res.rows[0].count, 10)).toBeGreaterThanOrEqual(12);
      } finally {
        await templateClient.end();
      }
    },
    120_000,
  );

  it("provisionTestDatabase clones template DB with all tables and PostGIS", async () => {
    const dbName = makeTestDbName("perf_clone_test");
    createdDbs.add(dbName);

    // No wall-clock budget: clone latency is runner-dependent and proves no
    // behavior. Perf is tracked by an independent benchmark job, not here.
    await provisionTestDatabase(adminUrl, dbName, { useTemplate: true });

    const client = new pg.Client(getPoolConfig(testDatabaseUrl(adminUrl, dbName)));
    await client.connect();
    try {
      const tablesRes = await client.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
      );
      const tableNames = tablesRes.rows.map((r) => r.table_name);
      expect(tableNames).toContain("cafes");
      expect(tableNames).toContain("checkins");
      expect(tableNames).toContain("profiles");
      expect(tableNames).toContain("schema_migrations");

      // Verify PostGIS extension is active
      const postgisRes = await client.query<{ extname: string }>(
        "select extname from pg_extension where extname = 'postgis'",
      );
      expect(postgisRes.rows.length).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("supports concurrent database provisioning without race conditions", async () => {
    const db1 = makeTestDbName("perf_par_1");
    const db2 = makeTestDbName("perf_par_2");
    createdDbs.add(db1);
    createdDbs.add(db2);

    await Promise.all([
      provisionTestDatabase(adminUrl, db1, { useTemplate: true }),
      provisionTestDatabase(adminUrl, db2, { useTemplate: true }),
    ]);

    const c1 = new pg.Client(getPoolConfig(testDatabaseUrl(adminUrl, db1)));
    const c2 = new pg.Client(getPoolConfig(testDatabaseUrl(adminUrl, db2)));
    await c1.connect();
    await c2.connect();
    try {
      const [r1, r2] = await Promise.all([
        c1.query("select 1 as ok"),
        c2.query("select 1 as ok"),
      ]);
      expect(r1.rows[0].ok).toBe(1);
      expect(r2.rows[0].ok).toBe(1);
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });

  it(
    "provisionTestDatabase falls back to standard migration when useTemplate is false",
    async () => {
      const dbName = makeTestDbName("fallback_migrate_test");
      createdDbs.add(dbName);

      await provisionTestDatabase(adminUrl, dbName, { useTemplate: false });

      const client = new pg.Client(getPoolConfig(testDatabaseUrl(adminUrl, dbName)));
      await client.connect();
      try {
        const res = await client.query("select count(*) from schema_migrations");
        expect(Number.parseInt(res.rows[0].count, 10)).toBeGreaterThanOrEqual(12);
      } finally {
        await client.end();
      }
    },
    120_000,
  );

});
