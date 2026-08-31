import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  DEFAULT_DB_URL,
  DEFAULT_TEMPLATE_DB_NAME,
  createTestSchema,
  dropTestSchema,
  ensureTemplateDatabase,
  integrationAdminUrl,
  makeTestDbName,
  makeTestSchemaName,
  provisionTestDatabase,
  quotedIdentifier,
  schemaDatabaseUrl,
  setSearchPath,
  testDatabaseUrl,
  withTestSchema,
} from "./helpers/db";
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

  it("makeTestSchemaName generates unique names with prefix and pid", () => {
    const s1 = makeTestSchemaName("custom_schema");
    const s2 = makeTestSchemaName("custom_schema");
    expect(s1).toMatch(/^custom_schema_\d+_[a-f0-9]{32}$/);
    expect(s2).toMatch(/^custom_schema_\d+_[a-f0-9]{32}$/);
    expect(s1).not.toBe(s2);
  });

  it("testDatabaseUrl replaces pathname on admin url", () => {
    const admin = "postgres://user:pass@localhost:5432/coffeemode";
    const testUrl = testDatabaseUrl(admin, "coffeemode_test_123");
    expect(testUrl).toBe("postgres://user:pass@localhost:5432/coffeemode_test_123");
  });

  it("schemaDatabaseUrl adds search_path options query parameter", () => {
    const base = "postgres://user:pass@localhost:5432/coffeemode";
    const schemaUrl = schemaDatabaseUrl(base, "worker_1");
    expect(schemaUrl).toContain("options=-c+search_path%3Dworker_1%2Cpublic");
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
      expect(() => integrationAdminUrl()).toThrow(/non-local or overridden host/);

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
});

describeIntegration("db test helpers — real Postgres template pooling and schema isolation", () => {
  const createdDbs = new Set<string>();
  const adminUrl = integrationAdminUrl();

  afterAll(async () => {
    const admin = new pg.Client(getPoolConfig(adminUrl));
    await admin.connect();
    try {
      for (const dbName of createdDbs) {
        await admin.query(`drop database if exists ${quotedIdentifier(dbName)} with (force)`);
      }
    } finally {
      await admin.end();
    }
  });

  it("ensureTemplateDatabase provisions and migrates the template database", async () => {
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
  });

  it("provisionTestDatabase clones template DB quickly with all tables and PostGIS", async () => {
    const dbName = makeTestDbName("perf_clone_test");
    createdDbs.add(dbName);

    const t0 = Date.now();
    await provisionTestDatabase(adminUrl, dbName, { useTemplate: true });
    const duration = Date.now() - t0;

    // Fast template clone should complete well under standard 15-migration sequential run
    expect(duration).toBeLessThan(5000);

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

  it("provisionTestDatabase falls back to standard migration when useTemplate is false", async () => {
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
  });

  it("isolates worker operations via withTestSchema and search_path", async () => {
    const client = new pg.Client(getPoolConfig(adminUrl));
    await client.connect();
    const schemaName = makeTestSchemaName("test_worker_iso");

    try {
      await withTestSchema(client, schemaName, async () => {
        await client.query(
          "create table isolated_records (id serial primary key, label text not null)",
        );
        await client.query("insert into isolated_records (label) values ('worker-record')");

        const records = await client.query<{ label: string }>(
          "select label from isolated_records",
        );
        expect(records.rows).toEqual([{ label: "worker-record" }]);
      });

      // After withTestSchema exits, schema is dropped and search_path is restored
      const checkRes = await client.query(
        "select schema_name from information_schema.schemata where schema_name = $1",
        [schemaName],
      );
      expect(checkRes.rows.length).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("supports manual createTestSchema, setSearchPath, and dropTestSchema lifecycle", async () => {
    const client = new pg.Client(getPoolConfig(adminUrl));
    await client.connect();
    const schemaName = makeTestSchemaName("manual_schema");

    try {
      await createTestSchema(client, schemaName);
      await setSearchPath(client, schemaName, "public");
      await client.query("create table manual_table (id serial primary key, value text)");
      await client.query("insert into manual_table (value) values ('test-val')");
      const res = await client.query<{ value: string }>("select value from manual_table");
      expect(res.rows[0].value).toBe("test-val");
    } finally {
      await dropTestSchema(client, schemaName);
      await client.query("set search_path to public");
      await client.end();
    }
  });
});
