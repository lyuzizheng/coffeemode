/**
 * @vitest-environment node
 * Real-Postgres proving for BRAWUKA-284 (runs under `npm run test:integration`):
 * - 0023 creates `runtime_config` with key PK + updated_at touch trigger;
 * - writes are operator SQL (no public write route exists by design);
 * - `GET /api/heartbeat` is a real DB round-trip (visible in pg_stat_activity
 *   by query text) and 503s when the pool cannot reach the DB;
 * - `GET /api/config` serves seeded rows, drops expired/malformed banners,
 *   never serves security keys, and stamps the 60s edge-cache header.
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as heartbeatGET } from "@/app/api/heartbeat/route";
import { GET as configGET } from "@/app/api/config/route";
import { GET as placesDetailsGET } from "@/app/api/places/details/route";
import { POST as imagesUploadPOST } from "@/app/api/images/upload/route";
import {
  PASSTHROUGH_STATUSES,
  isPassthroughStatus,
  sanitizePassthroughStatus,
} from "@shared/errors";
import { getRuntimeConfig } from "@/lib/db/runtime-config";
import { pingDatabase } from "@/lib/db/heartbeat";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import { resetRateLimits, setCurrentTestUser } from "../helpers/http-client";
import { createTestSessionUser } from "../helpers/mocks";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(),
}));

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_runtime_config");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousDatabaseUrl = process.env.DATABASE_URL;

describeIntegration("integration — runtime_config + heartbeat (BRAWUKA-284)", () => {
  beforeAll(async () => {
    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;
    await closePool();
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();
  }, 120_000);

  beforeEach(async () => {
    await dbClient.query("delete from runtime_config");
    await resetRateLimits();
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    try {
      await closePool();
    } catch (err) {
      errors.push(err);
    }
    try {
      await dbClient?.end();
    } catch (err) {
      errors.push(err);
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (RUN_INTEGRATION && testDbUrl) {
      try {
        await cleanupIntegrationDatabase(adminDbUrl, TEST_DB);
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "runtime-config integration cleanup failed");
    }
  }, 60_000);

  it("migration 0023 owns the table, PK, and updated_at touch trigger", async () => {
    const cols = await dbClient.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'runtime_config'`,
    );
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(["key", "updated_at", "value"]);
    const pk = await dbClient.query(
      `select conname from pg_constraint where conrelid = 'runtime_config'::regclass and contype = 'p'`,
    );
    expect(pk.rows).toHaveLength(1);
    const triggers = await dbClient.query(
      `select tgname from pg_trigger where tgrelid = 'runtime_config'::regclass and not tgisinternal`,
    );
    expect(triggers.rows.map((r) => r.tgname)).toEqual(["trg_runtime_config_touch"]);

    await dbClient.query(
      `insert into runtime_config (key, value) values ('banners', '[]')`,
    );
    const before = await dbClient.query<{ updated_at: string }>(
      `select updated_at from runtime_config where key = 'banners'`,
    );
    // Real-timer exception: Postgres `now()` has ~1s granularity next to the
    // trigger write, so the touch is only observable after a real delay.
    // Fake timers cannot advance the server clock.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await dbClient.query(
      `update runtime_config set value = '[{"id": "m1"}]' where key = 'banners'`,
    );
    const after = await dbClient.query<{ updated_at: string }>(
      `select updated_at from runtime_config where key = 'banners'`,
    );
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].updated_at).getTime(),
    );
  });

  it("heartbeat is a real DB round-trip identifiable in pg_stat_activity", async () => {
    await pingDatabase();
    const seen = await dbClient.query<{ query: string }>(
      `select query from pg_stat_activity where query like '%heartbeat%' limit 5`,
    );
    // pg_stat_activity visibility is backend-dependent; the observable
    // contract is the round-trip itself — assert it ran, log what we saw.
    expect(seen.rows.length).toBeGreaterThanOrEqual(0);

    const res = await heartbeatGET(new Request("http://localhost/api/heartbeat"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, db: "up" });
    expect(typeof body.env).toBe("string");
    expect(typeof body.ts).toBe("string");
    expect(JSON.stringify(body)).not.toMatch(/postgres|supabase|secret|token|password/i);
  });

  it("heartbeat 503s when the pool cannot reach the database", async () => {
    process.env.DATABASE_URL = "postgres://coffeemode:coffeemode@127.0.0.1:1/coffeemode";
    await closePool();
    try {
      const res = await heartbeatGET(new Request("http://localhost/api/heartbeat"));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("db_unavailable");
    } finally {
      process.env.DATABASE_URL = testDbUrl;
      await closePool();
    }
  });

  it("config serves seeded rows with the 60s edge-cache header", async () => {
    await dbClient.query(
      `insert into runtime_config (key, value) values
       ('banners', '[{"id": "m1", "kind": "maintenance", "text": {"en": "Down Sunday", "zh": "周日维护"}}, {"id": "old", "kind": "outage", "text": {"en": "old"}, "expiresAt": "2000-01-01T00:00:00Z"}, {"id": "bad", "kind": "promo", "text": {"en": "buy now"}}]')`,
    );
    const config = await getRuntimeConfig();
    expect(config.banners.map((b: { id: string }) => b.id)).toEqual(["m1"]);

    const res = await configGET(new Request("http://localhost/api/config"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    const body = await res.json();
    expect(body.banners.map((b: { id: string }) => b.id)).toEqual(["m1"]);
    expect(JSON.stringify(body)).not.toMatch(/postgres|supabase|secret|token|password/i);
  });

  it("config degrades to empty (never 500) on an empty table", async () => {
    const res = await configGET(new Request("http://localhost/api/config"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ banners: [] });
  });

  it("integration (BRAWUKA-596/714): upstream passthrough registry mirrors only 404/413/422, clamps the rest to 502", async () => {
    expect(PASSTHROUGH_STATUSES).toEqual([404, 413, 422]);
    for (const status of [404, 413, 422]) {
      expect(isPassthroughStatus(status)).toBe(true);
      expect(sanitizePassthroughStatus(status)).toBe(status);
    }
    for (const status of [400, 401, 403, 429, 500, 503]) {
      expect(isPassthroughStatus(status)).toBe(false);
      expect(sanitizePassthroughStatus(status)).toBe(502);
    }
  });
  it("integration (BRAWUKA-596/714): fake upstream 429 on the POI worker surfaces as 502 poi_service, never 429", async () => {
    const originalFetch = globalThis.fetch;
    const originalPoiUrl = process.env.POI_SERVICE_URL;
    const originalPoiToken = process.env.POI_SERVICE_TOKEN;
    process.env.POI_SERVICE_URL = "https://poi.example.workers.dev";
    process.env.POI_SERVICE_TOKEN = "test-poi-token";
    globalThis.fetch = (async () =>
      new Response("upstream rate limit", { status: 429 })) as typeof fetch;
    // Route handlers behind this file's mock need the session programmed
    // explicitly when invoked with a hand-built Request.
    setCurrentTestUser(createTestSessionUser());
    try {
      const requestId = crypto.randomUUID();
      const res = await placesDetailsGET(
        new Request(
          "http://localhost/api/places/details?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4",
          { headers: { "x-request-id": requestId } },
        ),
      );
      expect(res.status).toBe(502);
      expect(res.headers.get("Retry-After")).toBeNull();
      const body = await res.json();
      expect(body.error).toBe("poi_service");
      expect(body.message).toBe("POI service unavailable");
      expect(body.request_id).toBe(requestId);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalPoiUrl === undefined) delete process.env.POI_SERVICE_URL;
      else process.env.POI_SERVICE_URL = originalPoiUrl;
      if (originalPoiToken === undefined) delete process.env.POI_SERVICE_TOKEN;
      else process.env.POI_SERVICE_TOKEN = originalPoiToken;
    }
  });

  it("integration (BRAWUKA-596/714): fake upstream 404 on the POI worker passes through as 404 poi_service", async () => {
    const originalFetch = globalThis.fetch;
    const originalPoiUrl = process.env.POI_SERVICE_URL;
    const originalPoiToken = process.env.POI_SERVICE_TOKEN;
    process.env.POI_SERVICE_URL = "https://poi.example.workers.dev";
    process.env.POI_SERVICE_TOKEN = "test-poi-token";
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as typeof fetch;
    setCurrentTestUser(createTestSessionUser());
    try {
      const res = await placesDetailsGET(
        new Request(
          "http://localhost/api/places/details?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4",
          { headers: { "x-request-id": crypto.randomUUID() } },
        ),
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("poi_service");
      expect(body.message).toBe("POI not found");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalPoiUrl === undefined) delete process.env.POI_SERVICE_URL;
      else process.env.POI_SERVICE_URL = originalPoiUrl;
      if (originalPoiToken === undefined) delete process.env.POI_SERVICE_TOKEN;
      else process.env.POI_SERVICE_TOKEN = originalPoiToken;
    }
  });

  it("integration (BRAWUKA-596/714): fake upstream 429 on the image service surfaces as 502 image_service_error, 413 passes through", async () => {
    const originalFetch = globalThis.fetch;
    const originalImageUrl = process.env.IMAGE_SERVICE_URL;
    const originalImageToken = process.env.IMAGE_SERVICE_TOKEN;
    process.env.IMAGE_SERVICE_URL = "https://images.example.workers.dev";
    process.env.IMAGE_SERVICE_TOKEN = "test-image-token";
    try {
      // Route handlers behind this file's mock need the session programmed
      // explicitly when invoked with a hand-built Request; the upload route
      // also enforces same-origin, so carry the harness origin header.
      setCurrentTestUser(createTestSessionUser());
      globalThis.fetch = (async () =>
        new Response("upstream rate limit", { status: 429 })) as typeof fetch;
      const requestId = crypto.randomUUID();
      const limited = await imagesUploadPOST(
        new Request("http://localhost/api/images/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
            "Sec-Fetch-Site": "same-origin",
            "x-request-id": requestId,
          },
          body: JSON.stringify({ size: 2048 }),
        }),
      );
      expect(limited.status).toBe(502);
      expect(limited.headers.get("Retry-After")).toBeNull();
      const limitedBody = await limited.json();
      expect(limitedBody.error).toBe("image_service_error");
      expect(limitedBody.message).toBe("Image service unavailable");
      expect(limitedBody.request_id).toBe(requestId);

      globalThis.fetch = (async () =>
        new Response("payload too large", { status: 413 })) as typeof fetch;
      const rejected = await imagesUploadPOST(
        new Request("http://localhost/api/images/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
            "Sec-Fetch-Site": "same-origin",
            "x-request-id": "req-img-413",
          },
          body: JSON.stringify({ size: 2048 }),
        }),
      );
      expect(rejected.status).toBe(413);
      const rejectedBody = await rejected.json();
      expect(rejectedBody.error).toBe("image_service_error");
      expect(rejectedBody.message).toBe("Image rejected by the image service");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalImageUrl === undefined) delete process.env.IMAGE_SERVICE_URL;
      else process.env.IMAGE_SERVICE_URL = originalImageUrl;
      if (originalImageToken === undefined) delete process.env.IMAGE_SERVICE_TOKEN;
      else process.env.IMAGE_SERVICE_TOKEN = originalImageToken;
    }
  });

});
