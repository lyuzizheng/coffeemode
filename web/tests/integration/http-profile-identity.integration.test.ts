/**
 * Path 3 — profile, settings & public identity lifecycle (spec 0008 §6, Slice 2C).
 *
 * Every state change and every assertion goes through the external HTTP API
 * (Next.js Route Handlers via the Stage 1 `http-client` harness): no `lib/db/*`
 * call ever asserts or mutates product state. Two harness-owned seams only:
 * persona profile rows + one slice-local cafe/check-in pair are seeded with SQL
 * (Slice 2C's author-projection fixture; the full media pipeline that would
 * create them over HTTP belongs to Slice 2B), and `getCurrentUser` is resolved
 * through the `vi.mock("@/lib/auth/get-user")` session seam the harness owns.
 *
 * Gate: `RUN_INTEGRATION=1` against the provisioned template-clone
 * Postgres/PostGIS (`tests/helpers/db.ts`). Self-skips without the gate so
 * `npm test` stays green without Docker.
 */
import pg from "pg";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getProfileRoute, PATCH as patchProfileRoute } from "@/app/api/profile/route";
import { PATCH as patchIdentityRoute } from "@/app/api/profile/identity/route";
import { GET as getCafeDetailRoute } from "@/app/api/cafes/[id]/route";
import { GET as getFeedRoute } from "@/app/api/cafes/[id]/checkins/route";
import type { UserProfileDto } from "@/lib/db/profile";
import type { ProfileIdentityDto, PublicAuthor } from "@/types/identity";
import type { PublicCafeDetail } from "@/types/cafes";
import type { CheckInFeedPage } from "@/types/checkins";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import {
  apiClient,
  createHttpTestUsers,
  routeParams,
  seedHttpTestUsers,
  type HttpTestUsers,
  type RouteContext,
} from "../helpers/http-client";
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
const describePath3 = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_profile_identity");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousDatabaseUrl = process.env.DATABASE_URL;

const users: HttpTestUsers = createHttpTestUsers();

// Slice-local author-projection fixture: one Singapore cafe created by User A
// with a single creation check-in. Seeded with SQL because the HTTP creation
// pipeline (POI inject + presigned media round-trip) is Slice 2B's contract,
// not this slice's — every assertion below still runs over HTTP.
const CAFE_P3 = "c0000000-0000-4000-a000-0000000000c1";
const CHECKIN_P3 = "c0000000-0000-4000-a000-0000000000e1";

/** `NextRequest`-typed profile/identity handlers take no route ctx. */
type NoCtx = undefined;
/** `{ params: Promise<{ id }> }` ctx for the cafe detail + feed handlers. */
type IdCtx = RouteContext<{ id: string }>;

async function seedProfileSlice(client: pg.Client): Promise<void> {
  await seedHttpTestUsers(client, users);
  await client.query(
    `insert into cafes (id, name, location, address, city, tz, price_range, created_by)
     values ($1, 'Pioneer House Brew', ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
             '1 Orchard Rd, Singapore', 'singapore', 'Asia/Singapore', 2, $4)`,
    [CAFE_P3, 103.8318, 1.3048, users.userA.id],
  );
  await client.query(
    `insert into checkins (id, cafe_id, user_id, is_creation, scores, max_stay, note)
     values ($1, $2, $3, true, '{"overall": 90}'::jsonb, 'unlimited', 'first pour')`,
    [CHECKIN_P3, CAFE_P3, users.userA.id],
  );
}

interface ProfilePayload {
  profile: UserProfileDto;
  stats: { cafesCount: number; checkinsCount: number };
}

interface ErrorPayload {
  error: string;
}

type IdentityPayload = { ok: boolean } & ProfileIdentityDto;

async function readAuthor(session: HttpTestUsers[keyof HttpTestUsers] | null): Promise<{
  detail: PublicAuthor | null;
  feed: PublicAuthor | null;
}> {
  const client = apiClient(session);
  const detail = await client.get<PublicCafeDetail, IdCtx, Request>(
    getCafeDetailRoute,
    `/api/cafes/${CAFE_P3}`,
    {},
    routeParams({ id: CAFE_P3 }),
  );
  expect(detail.status).toBe(200);
  const feed = await client.get<CheckInFeedPage, IdCtx, Request>(
    getFeedRoute,
    `/api/cafes/${CAFE_P3}/checkins`,
    {},
    routeParams({ id: CAFE_P3 }),
  );
  expect(feed.status).toBe(200);
  return { detail: detail.data.author, feed: feed.data.checkins[0]?.author ?? null };
}

describePath3("path 3 — profile & public identity lifecycle over HTTP (spec 0008 §6)", () => {
  beforeAll(async () => {
    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();
  }, 120_000);

  // Hard isolation: every `it` starts from the same baseline, so lifecycle
  // chains live inside a single `it` and tests never depend on order.
  beforeEach(async () => {
    await dbClient.query(
      "truncate table profiles, cafes, rate_limits, image_upload_intents, navigations restart identity cascade",
    );
    await seedProfileSlice(dbClient);
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    try {
      await closePool();
    } catch (error) {
      errors.push(error);
    }
    try {
      await dbClient?.end();
    } catch (error) {
      errors.push(error);
    }
    if (RUN_INTEGRATION && testDbUrl) {
      try {
        await cleanupIntegrationDatabase(adminDbUrl, TEST_DB);
      } catch (error) {
        errors.push(error);
      }
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "profile-identity integration cleanup failed");
    }
  }, 60_000);

  it("path 3 (spec 0008 §6): GET /api/profile as anonymous → 401 unauthorized", async () => {
    const res = await apiClient(null).get<ErrorPayload, NoCtx, NextRequest>(
      getProfileRoute,
      "/api/profile",
    );
    expect(res.status).toBe(401);
    expect(res.data.error).toBe("unauthorized");
  });

  it("path 3 (spec 0008 §6): GET /api/profile returns the DTO with default anonymity + lifecycle stats", async () => {
    const res = await apiClient(users.userA).get<ProfilePayload, NoCtx, NextRequest>(
      getProfileRoute,
      "/api/profile",
    );
    expect(res.status).toBe(200);
    expect(res.data.profile.id).toBe(users.userA.id);
    expect(res.data.profile.displayName).toBe("HTTP Ann");
    expect(res.data.profile.currentCity).toBe("singapore");
    // DG13 factory default: anonymous until the user opts in.
    expect(res.data.profile.showPublicIdentity).toBe(false);
    expect(res.data.profile.publicHandle).toBeNull();
    expect(res.data.profile.identityConsentedAt).toBeNull();
    expect(res.data.profile.publicHandleChangedAt).toBeNull();
    // Stats move with lifecycle events: A's seeded creation cafe + check-in.
    expect(res.data.stats).toEqual({ cafesCount: 1, checkinsCount: 1 });
  });

  it("path 3 (spec 0008 §6): fresh User D reads default anonymity with zero stats", async () => {
    const res = await apiClient(users.userD).get<ProfilePayload, NoCtx, NextRequest>(
      getProfileRoute,
      "/api/profile",
    );
    expect(res.status).toBe(200);
    expect(res.data.profile.showPublicIdentity).toBe(false);
    expect(res.data.profile.publicHandle).toBeNull();
    expect(res.data.stats).toEqual({ cafesCount: 0, checkinsCount: 0 });
  });

  it("path 3 (spec 0008 §6, DG107): PATCH /api/profile validates displayName 1–24 chars", async () => {
    const client = apiClient(users.userA);
    for (const displayName of ["", "x".repeat(25)]) {
      const res = await client.patch<ErrorPayload, NoCtx, NextRequest>(
        patchProfileRoute,
        "/api/profile",
        { displayName },
      );
      expect(res.status).toBe(400);
      expect(res.data.error).toBe("display_name_length");
    }
    const ok = await client.patch<{ profile: UserProfileDto }, NoCtx, NextRequest>(
      patchProfileRoute,
      "/api/profile",
      { displayName: "  Pioneer Ann  " },
    );
    expect(ok.status).toBe(200);
    expect(ok.data.profile.displayName).toBe("Pioneer Ann");
  });

  it("path 3 (spec 0008 §6, DG50): PATCH /api/profile validates currentCity against launch cities", async () => {
    const client = apiClient(users.userA);
    const bad = await client.patch<ErrorPayload, NoCtx, NextRequest>(
      patchProfileRoute,
      "/api/profile",
      { currentCity: "atlantis" },
    );
    expect(bad.status).toBe(400);
    expect(bad.data.error).toBe("invalid_current_city");
    const ok = await client.patch<{ profile: UserProfileDto }, NoCtx, NextRequest>(
      patchProfileRoute,
      "/api/profile",
      { currentCity: "tokyo" },
    );
    expect(ok.status).toBe(200);
    expect(ok.data.profile.currentCity).toBe("tokyo");
  });

  it("path 3 (spec 0008 §6, DG107): PATCH /api/profile rejects empty patch + anonymous writes", async () => {
    const empty = await apiClient(users.userA).patch<ErrorPayload, NoCtx, NextRequest>(
      patchProfileRoute,
      "/api/profile",
      {},
    );
    expect(empty.status).toBe(400);
    expect(empty.data.error).toBe("empty_patch");
    const anon = await apiClient(null).patch<ErrorPayload, NoCtx, NextRequest>(
      patchProfileRoute,
      "/api/profile",
      { displayName: "Ghost" },
    );
    expect(anon.status).toBe(401);
    expect(anon.data.error).toBe("unauthorized");
  });

  it("path 3 (spec 0008 §11): PATCH /api/profile from a cross-site Origin → 403 forbidden_origin", async () => {
    const res = await apiClient(users.userA).patch<ErrorPayload, NoCtx, NextRequest>(
      patchProfileRoute,
      "/api/profile",
      { displayName: "Evil" },
      { headers: { origin: "https://evil.example" } },
    );
    expect(res.status).toBe(403);
    expect(res.data.error).toBe("forbidden_origin");
  });

  it("path 3 (spec 0008 §6): PATCH /api/profile/identity as anonymous → 401 unauthorized", async () => {
    const res = await apiClient(null).patch<ErrorPayload, NoCtx, NextRequest>(
      patchIdentityRoute,
      "/api/profile/identity",
      { showPublicIdentity: true },
    );
    expect(res.status).toBe(401);
    expect(res.data.error).toBe("unauthorized");
  });

  it("path 3 (spec 0008 §6, Q11): PATCH /api/profile/identity rejects malformed handles", async () => {
    const client = apiClient(users.userA);
    for (const publicHandle of ["ab", "bad handle!", "-leading"]) {
      const res = await client.patch<ErrorPayload, NoCtx, NextRequest>(
        patchIdentityRoute,
        "/api/profile/identity",
        { showPublicIdentity: true, publicHandle },
      );
      expect(res.status).toBe(400);
      expect(res.data.error).toBe("invalid_handle");
    }
  });

  it("path 3 (spec 0008 §6, Q5/Q8): explicit opt-in projects the author onto detail + feed in one motion", async () => {
    const before = await readAuthor(users.userD);
    expect(before.detail).toBeNull();
    expect(before.feed).toBeNull();

    const optIn = await apiClient(users.userA).patch<IdentityPayload, NoCtx, NextRequest>(
      patchIdentityRoute,
      "/api/profile/identity",
      { showPublicIdentity: true, publicHandle: "pioneer-a" },
    );
    expect(optIn.status).toBe(200);
    expect(optIn.data).toMatchObject({
      ok: true,
      showPublicIdentity: true,
      publicHandle: "pioneer-a",
    });
    expect(optIn.data.identityConsentedAt).not.toBeNull();
    expect(optIn.data.publicHandleChangedAt).not.toBeNull();

    const after = await readAuthor(users.userD);
    expect(after.detail).toEqual({
      handle: "pioneer-a",
      display_name: "HTTP Ann",
      avatar_url: null,
    });
    expect(after.feed).toEqual({
      handle: "pioneer-a",
      display_name: "HTTP Ann",
      avatar_url: null,
    });
  });

  it("path 3 (spec 0008 §6, Q2): opt-in without a handle auto-generates slug(display_name)-xxxx", async () => {
    const res = await apiClient(users.userB).patch<IdentityPayload, NoCtx, NextRequest>(
      patchIdentityRoute,
      "/api/profile/identity",
      { showPublicIdentity: true },
    );
    expect(res.status).toBe(200);
    expect(res.data.showPublicIdentity).toBe(true);
    expect(res.data.publicHandle).toMatch(/^http-ben-[0-9a-f]{4}$/);
    // Server-generated handles leave changed_at null so the first user edit is immediate.
    expect(res.data.publicHandleChangedAt).toBeNull();
  });

  it("path 3 (spec 0008 §6, Q8): opt-out restores author null everywhere with rows intact, then losslessly re-opts in", async () => {
    const clientA = apiClient(users.userA);
    const optIn = await clientA.patch<IdentityPayload, NoCtx, NextRequest>(
      patchIdentityRoute,
      "/api/profile/identity",
      { showPublicIdentity: true, publicHandle: "pioneer-a" },
    );
    expect(optIn.status).toBe(200);

    const optOut = await clientA.patch<IdentityPayload, NoCtx, NextRequest>(
      patchIdentityRoute,
      "/api/profile/identity",
      { showPublicIdentity: false },
    );
    expect(optOut.status).toBe(200);
    expect(optOut.data.showPublicIdentity).toBe(false);
    // Released handle stays reserved on the row; consent is cleared.
    expect(optOut.data.publicHandle).toBe("pioneer-a");
    expect(optOut.data.identityConsentedAt).toBeNull();

    const hidden = await readAuthor(users.userD);
    expect(hidden.detail).toBeNull();
    expect(hidden.feed).toBeNull();

    const profile = await clientA.get<ProfilePayload, NoCtx, NextRequest>(
      getProfileRoute,
      "/api/profile",
    );
    expect(profile.data.profile.showPublicIdentity).toBe(false);
    expect(profile.data.profile.publicHandle).toBe("pioneer-a");
    // No rewrite: the seeded creation check-in still counts toward stats.
    expect(profile.data.stats).toEqual({ cafesCount: 1, checkinsCount: 1 });

    const reOptIn = await clientA.patch<IdentityPayload, NoCtx, NextRequest>(
      patchIdentityRoute,
      "/api/profile/identity",
      { showPublicIdentity: true },
    );
    expect(reOptIn.status).toBe(200);
    expect(reOptIn.data.publicHandle).toBe("pioneer-a");
    const restored = await readAuthor(users.userD);
    expect(restored.detail).toEqual({
      handle: "pioneer-a",
      display_name: "HTTP Ann",
      avatar_url: null,
    });
    expect(restored.feed).toEqual({
      handle: "pioneer-a",
      display_name: "HTTP Ann",
      avatar_url: null,
    });
  });

  it("path 3 (spec 0008 §6, Q2): a released handle stays reserved — another user gets 409 handle_taken", async () => {
    const clientA = apiClient(users.userA);
    expect(
      (
        await clientA.patch<IdentityPayload, NoCtx, NextRequest>(
          patchIdentityRoute,
          "/api/profile/identity",
          { showPublicIdentity: true, publicHandle: "pioneer-a" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await clientA.patch<IdentityPayload, NoCtx, NextRequest>(
          patchIdentityRoute,
          "/api/profile/identity",
          { showPublicIdentity: false },
        )
      ).status,
    ).toBe(200);

    const stolen = await apiClient(users.userC).patch<ErrorPayload, NoCtx, NextRequest>(
      patchIdentityRoute,
      "/api/profile/identity",
      { showPublicIdentity: true, publicHandle: "pioneer-a" },
    );
    expect(stolen.status).toBe(409);
    expect(stolen.data.error).toBe("handle_taken");
  });

  it("path 3 (spec 0008 §6): user-chosen handle change inside the 7-day cooldown → 400 handle_change_too_soon", async () => {
    const client = apiClient(users.userA);
    expect(
      (
        await client.patch<IdentityPayload, NoCtx, NextRequest>(
          patchIdentityRoute,
          "/api/profile/identity",
          { showPublicIdentity: true, publicHandle: "pioneer-a" },
        )
      ).status,
    ).toBe(200);

    // Re-asserting the same handle is idempotent — not a change, no cooldown.
    const same = await client.patch<IdentityPayload, NoCtx, NextRequest>(
      patchIdentityRoute,
      "/api/profile/identity",
      { showPublicIdentity: true, publicHandle: "pioneer-a" },
    );
    expect(same.status).toBe(200);
    expect(same.data.publicHandle).toBe("pioneer-a");

    const tooSoon = await client.patch<ErrorPayload, NoCtx, NextRequest>(
      patchIdentityRoute,
      "/api/profile/identity",
      { showPublicIdentity: true, publicHandle: "pioneer-b" },
    );
    expect(tooSoon.status).toBe(400);
    expect(tooSoon.data.error).toBe("handle_change_too_soon");
  });
});
