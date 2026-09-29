/**
 * Real-Postgres integration suite — profile and author identity database contract suite.
 * Extracted from db.integration.test.ts (BRAWUKA-743).
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CafeNotFoundError,
} from "@/lib/validation/checkin";
import {
  createCheckIn,
} from "@/lib/db/checkins";
import {
  createCafeWithFirstCheckIn,
  getCafe,
} from "@/lib/db/cafes";
import type { CafeDetailWithAuthor } from "@/lib/db/cafes";
import { toPublicCafeDetail } from "@/lib/cafes/presentation";
import {
  getProfile,
  getUserStats,
  updateProfile,
  getUserCheckIns,
  getUserCafes,
} from "@/lib/db/profile";
import {
  updateProfileIdentity,
  InvalidHandleError,
  HandleTakenError,
  HandleChangeTooSoonError,
} from "@/lib/db/identity";
import {
  listPublicCheckIns,
} from "@/lib/discovery/feed";
import { checkUploadIntents, recordUploadIntent } from "@/lib/db/image-uploads";
import { PhotoIntentError } from "@/lib/images/provision-photos";
import {
  setupTestDatabase,
  teardownTestDatabase,
  type TestDatabaseContext,
} from "../helpers/db";
import {
  CAFE_A,
  CHECKIN_A1,
  SERVICE_ACCOUNT_ID,
  U1,
  U2,
  fakeProvisionPhotosDeps,
  resetTestDatabaseTables,
} from "../helpers/fixtures";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeDb = RUN_INTEGRATION ? describe : describe.skip;

describeDb("integration — profile and author identity database contract suite", () => {
  let ctx: TestDatabaseContext;
  let dbClient: pg.Client;

  beforeAll(async () => {
    ctx = await setupTestDatabase("coffeemode_profile_id");
    dbClient = ctx.dbClient;
  }, 120_000);

  afterAll(async () => {
    if (ctx) {
      await teardownTestDatabase(ctx);
    }
  }, 60_000);

  beforeEach(async () => {
    await resetTestDatabaseTables(dbClient);
  });

  describe("public author identity reads (#139 Stage 2)", () => {
    /** getCafe narrowed for the public projection (asserts the seed row exists). */
    async function publicDetail(id: string) {
      const cafe = await getCafe(id);
      expect(cafe).not.toBeNull();
      return toPublicCafeDetail(cafe as CafeDetailWithAuthor);
    }

    function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
      if (Array.isArray(value)) {
        for (const item of value) collectKeys(item, keys);
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          keys.add(k);
          collectKeys(v, keys);
        }
      }
      return keys;
    }

    it("defaults to author:null on cafe detail and both feed modes", async () => {
      expect((await publicDetail(CAFE_A)).author).toBeNull();
      for (const mode of ["newest", "helpful"] as const) {
        const page = await listPublicCheckIns({ cafeId: CAFE_A, mode, viewerId: null });
        expect(page.checkins.length).toBeGreaterThan(0);
        for (const c of page.checkins) expect(c.author).toBeNull();
      }
    });

    it("opt-in surfaces the consented author on cafe detail and feed", async () => {
      await dbClient.query(
        "update profiles set display_name = 'Nomad One', avatar_url = 'https://img.example/a.webp' where id = $1",
        [U1],
      );
      const dto = await updateProfileIdentity(U1, { showPublicIdentity: true });
      expect(dto.showPublicIdentity).toBe(true);
      expect(dto.publicHandle).toMatch(/^[a-z0-9][a-z0-9_-]{2,29}$/);

      const expected = {
        handle: dto.publicHandle,
        display_name: "Nomad One",
        avatar_url: "https://img.example/a.webp",
      };
      expect((await publicDetail(CAFE_A)).author).toEqual(expected);
      for (const mode of ["newest", "helpful"] as const) {
        const page = await listPublicCheckIns({ cafeId: CAFE_A, mode, viewerId: null });
        expect(page.checkins.find((c) => c.id === CHECKIN_A1)?.author).toEqual(expected);
      }
    });

    it("revocation restores author:null with all content intact (no deletion)", async () => {
      await updateProfileIdentity(U1, { showPublicIdentity: true });
      const before = await listPublicCheckIns({ cafeId: CAFE_A, mode: "newest", viewerId: null });
      expect(before.checkins.find((c) => c.id === CHECKIN_A1)?.author).not.toBeNull();

      const revoked = await updateProfileIdentity(U1, { showPublicIdentity: false });
      expect(revoked.showPublicIdentity).toBe(false);

      expect((await publicDetail(CAFE_A)).author).toBeNull();
      const after = await listPublicCheckIns({ cafeId: CAFE_A, mode: "newest", viewerId: null });
      const row = after.checkins.find((c) => c.id === CHECKIN_A1);
      expect(row).toBeDefined();
      expect(row?.author).toBeNull();
      // Content untouched: handle stays reserved, consent timestamp cleared.
      const kept = await dbClient.query(
        "select public_handle, identity_consented_at from profiles where id = $1",
        [U1],
      );
      expect(kept.rows[0].public_handle).not.toBeNull();
      expect(kept.rows[0].identity_consented_at).toBeNull();
    });

    it("service-account and null created_by cafes keep author:null + maintained_by_service marker", async () => {
      // Even an opted-in service-account profile must never render as author.
      await dbClient.query(
        "update profiles set show_public_identity = true, public_handle = 'coffeemode' where id = $1",
        [SERVICE_ACCOUNT_ID],
      );
      for (const createdBy of [SERVICE_ACCOUNT_ID, null]) {
        await dbClient.query("update cafes set created_by = $1 where id = $2", [createdBy, CAFE_A]);
        const pub = await publicDetail(CAFE_A);
        expect(pub.author).toBeNull();
        expect(pub.maintained_by_service).toBe(true);
        expect(pub).not.toHaveProperty("created_by");
      }
    });

    it("public DTOs expose no internal UUID and no user_id/by keys", async () => {
      await dbClient.query("update profiles set display_name = 'Nomad One' where id = $1", [U1]);
      await updateProfileIdentity(U1, { showPublicIdentity: true });
      // Stored photo attribution still carries the internal id — the public
      // projection must strip it.
      const photoCheckin = randomUUID();
      await dbClient.query(
        "insert into checkins (id, cafe_id, user_id, scores, photos) values ($1, $2, $3, '{}'::jsonb, $4::jsonb)",
        [
          photoCheckin,
          CAFE_A,
          U1,
          JSON.stringify([
            {
              id: "img-x",
              original: "original/img-x.webp",
              card: "card/img-x.webp",
              thumbnail: "thumbnail/img-x.webp",
              w: 1,
              h: 1,
              by: U1,
              at: "2026-08-01T10:00:00.000Z",
            },
          ]),
        ],
      );
      const pub = await publicDetail(CAFE_A);
      const page = await listPublicCheckIns({ cafeId: CAFE_A, mode: "newest", viewerId: null });
      const payload = JSON.stringify({ cafe: pub, feed: page });
      // Internal author UUIDs never appear (cafe/check-in resource ids are public by design).
      for (const internalId of [U1, U2, SERVICE_ACCOUNT_ID]) {
        expect(payload).not.toContain(internalId);
      }
      const keys = collectKeys({ cafe: pub, feed: page });
      for (const banned of ["user_id", "by", "created_by"]) {
        expect(keys.has(banned)).toBe(false);
      }
      // The opted-in author is present but carries only public-safe fields.
      expect(pub.author).toEqual({
        handle: expect.any(String),
        display_name: "Nomad One",
        avatar_url: null,
      });
      expect(page.checkins.find((c) => c.id === photoCheckin)?.author).toEqual(pub.author);
    });
  });

  describe("profile queries on real Postgres (profile-page slice #152)", () => {
    it("gets user profile and stats accurately", async () => {
      const p = await getProfile(U1);
      expect(p).not.toBeNull();
      expect(p?.id).toBe(U1);
      expect(p?.displayName).toBe("u1");

      const s = await getUserStats(U1);
      expect(s.cafesCount).toBeGreaterThanOrEqual(1);
      expect(s.checkinsCount).toBeGreaterThanOrEqual(1);
    });

    it("updates display_name and current_city", async () => {
      const updated = await updateProfile(U1, {
        displayName: "Nomad Alex",
        currentCity: "tokyo",
      });
      expect(updated?.displayName).toBe("Nomad Alex");
      expect(updated?.currentCity).toBe("tokyo");

      const fetched = await getProfile(U1);
      expect(fetched?.displayName).toBe("Nomad Alex");
      expect(fetched?.currentCity).toBe("tokyo");
    });

    it("returns user check-ins and distinct cafes with pagination", async () => {
      const checkinsResult = await getUserCheckIns(U1, { limit: 10 });
      expect(checkinsResult.items.length).toBeGreaterThanOrEqual(1);
      expect(checkinsResult.items[0]?.cafe_id).toBe(CAFE_A);

      const cafesResult = await getUserCafes(U1, { limit: 10 });
      expect(cafesResult.items.length).toBeGreaterThanOrEqual(1);
      expect(cafesResult.items[0]?.id).toBe(CAFE_A);
      expect(cafesResult.items[0]?.is_creation).toBe(true);
    });

    it("correctly handles soft-deleted cafes in stats, check-ins, and cafe lists (issue #219)", async () => {
      const CAFE_B = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a88";
      const CHECKIN_B1 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99";
      await dbClient.query(
        `insert into cafes (id, name, location, city, created_by, tz)
         values ($1, 'Cafe B', ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography, 'singapore', $2, 'Asia/Singapore')`,
        [CAFE_B, U1],
      );
      await dbClient.query(
        `insert into checkins (id, cafe_id, user_id, is_creation, scores)
         values ($1, $2, $3, false, '{"coffee": 90}'::jsonb)`,
        [CHECKIN_B1, CAFE_B, U1],
      );

      const beforeStats = await getUserStats(U1);
      expect(beforeStats.cafesCount).toBe(2);
      expect(beforeStats.checkinsCount).toBe(2);

      await dbClient.query("update cafes set deleted_at = now() where id = $1", [CAFE_B]);
      // cafesCount excludes soft-deleted cafe; checkinsCount still counts checkins
      const afterStats = await getUserStats(U1);
      expect(afterStats.cafesCount).toBe(1);
      expect(afterStats.checkinsCount).toBe(2);

      // getUserCheckIns returns cafeIsDeleted = true for deleted cafe
      const checkins = await getUserCheckIns(U1);
      const bCheckin = checkins.items.find((i) => i.id === CHECKIN_B1);
      expect(bCheckin?.cafe_is_deleted).toBe(true);
      const aCheckin = checkins.items.find((i) => i.id === CHECKIN_A1);
      expect(aCheckin?.cafe_is_deleted).toBe(false);

      // getUserCafes completely excludes soft-deleted cafe
      const userCafes = await getUserCafes(U1);
      expect(userCafes.items.some((c) => c.id === CAFE_B)).toBe(false);
      expect(userCafes.items.some((c) => c.id === CAFE_A)).toBe(true);
    });

    it("check-in creation rejects attaching to a soft-deleted cafe on real Postgres (issue #219)", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      await dbClient.query("update cafes set deleted_at = now() where id = $1", [CAFE_A]);

      await expect(
        createCheckIn(
          U1,
          { cafe_id: CAFE_A, scores: { overall: 80 }, photo_ids: [photoId] },
          fakeProvisionPhotosDeps(),
        ),
      ).rejects.toThrow(CafeNotFoundError);
    });

    it("completes checkin-target photo upload and merges into cafe gallery on real Postgres (#274)", async () => {
      // U2 has no check-in at CAFE_A (U1 owns the seed CHECKIN_A1), so the
      // DG64 revisit gate cannot fire — only the photo path is exercised.
      const photoId = randomUUID();
      await recordUploadIntent(U2, photoId);

      const created = await createCheckIn(
        U2,
        { cafe_id: CAFE_A, scores: { overall: 80 }, photo_ids: [photoId] },
        fakeProvisionPhotosDeps(),
      );
      expect(created.checkin_id).toBeDefined();

      // Verify photo is attached to checkin with source attribution
      const checkinRes = await dbClient.query("select photos from checkins where id = $1", [created.checkin_id]);
      const photos = checkinRes.rows[0].photos as Array<Record<string, unknown>>;
      expect(photos.some((p) => p.id === photoId)).toBe(true);
      expect(photos.find((p) => p.id === photoId)).toMatchObject({
        source: { type: "checkin", id: created.checkin_id },
      });

      // Verify photo is merged into cafe gallery
      const cafeRes = await dbClient.query("select gallery from cafes where id = $1", [CAFE_A]);
      const gallery = cafeRes.rows[0].gallery as Array<Record<string, unknown>>;
      expect(gallery.some((p) => p.id === photoId)).toBe(true);

      // Verify intent is consumed
      const intentRes = await dbClient.query(
        "select image_uuid from image_upload_intents where image_uuid = $1",
        [photoId],
      );
      expect(intentRes.rows).toHaveLength(0);
    });

    it("creation photo upload consumes the intent and mounts into gallery on real Postgres (#274)", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);

      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: `Cover Photo Roasters ${randomUUID().slice(0, 8)}`,
          lat: 1.3005,
          lng: 103.832,
          city: "singapore",
          checkin: {
            scores: { overall: 80 },
            max_stay: "unlimited",
            note: "Photo attach verification",
            photo_ids: [photoId],
          },
        },
        fakeProvisionPhotosDeps(),
      );
      expect(created.cafe_id).toBeDefined();

      // Verify photo is in gallery
      const cafeRes = await dbClient.query("select gallery from cafes where id = $1", [created.cafe_id]);
      const gallery = cafeRes.rows[0].gallery as Array<Record<string, unknown>>;
      expect(gallery.some((p) => p.id === photoId)).toBe(true);

      // Verify intent is consumed
      const intentRes = await dbClient.query(
        "select image_uuid from image_upload_intents where image_uuid = $1",
        [photoId],
      );
      expect(intentRes.rows).toHaveLength(0);

      await dbClient.query("delete from checkins where cafe_id = $1", [created.cafe_id]);
      await dbClient.query("delete from cafes where id = $1", [created.cafe_id]);
    });

    it("creation photo upload with an unrecorded intent fails fast (single-use guarantee)", async () => {
      await expect(
        createCafeWithFirstCheckIn(
          U1,
          {
            name: `Unrecorded Photo Roasters ${randomUUID().slice(0, 8)}`,
            lat: 1.3005,
            lng: 103.832,
            city: "singapore",
            checkin: {
              scores: { overall: 80 },
              max_stay: "unlimited",
              note: "Unrecorded intent verification",
              photo_ids: [randomUUID()],
            },
          },
          fakeProvisionPhotosDeps(),
        ),
      ).rejects.toBeInstanceOf(PhotoIntentError);
    });

    it("batch upload intent partial-consume rolls back creation and restores unconsumed intents (BRAWUKA-739 / BRAWUKA-791)", async () => {
      const testCafeId = randomUUID();
      await dbClient.query(
        `insert into cafes (id, name, location, city, created_by, tz)
         values ($1, 'Batch Test Cafe', ST_SetSRID(ST_MakePoint(103.85, 1.3), 4326)::geography,
                 'singapore', $2, 'Asia/Singapore')`,
        [testCafeId, U1],
      );

      const photoA = randomUUID();
      const photoB = randomUUID();
      await recordUploadIntent(U2, photoA);
      await recordUploadIntent(U2, photoB);

      // Both intents pass pre-check
      expect(await checkUploadIntents(U2, [photoA, photoB])).toEqual(
        expect.arrayContaining([photoA, photoB]),
      );

      const deps = fakeProvisionPhotosDeps();
      const originalProcessImage = deps.processImage;
      deps.processImage = async (imageUuid, urls) => {
        if (imageUuid === photoB) {
          // Deterministically delete photoB in real Postgres before transaction batch consume
          await dbClient.query("delete from image_upload_intents where image_uuid = $1", [photoB]);
        }
        return originalProcessImage(imageUuid, urls);
      };

      // Real check-in create path with real batch consume: pre-check passes,
      // but in-tx batch consume detects missing photoB -> PhotoIntentError thrown.
      await expect(
        createCheckIn(
          U2,
          {
            cafe_id: testCafeId,
            scores: { overall: 75, wifi: 80 },
            max_stay: "unlimited",
            note: "Partial consume test",
            photo_ids: [photoA, photoB],
          },
          deps,
        ),
      ).rejects.toBeInstanceOf(PhotoIntentError);

      // 1. Transaction rolled back: no check-in row committed
      const checkinsRes = await dbClient.query(
        "select id from checkins where cafe_id = $1",
        [testCafeId],
      );
      expect(checkinsRes.rows).toHaveLength(0);

      // 2. Cafe gallery was not modified
      const cafeRes = await dbClient.query(
        "select gallery from cafes where id = $1",
        [testCafeId],
      );
      const gallery = (cafeRes.rows[0].gallery ?? []) as Array<{ id: string }>;
      expect(gallery.some((p) => p.id === photoA || p.id === photoB)).toBe(false);

      // 3. photoB was consumed/deleted outside tx, but photoA's in-tx delete was ROLLED BACK
      expect(await checkUploadIntents(U2, [photoB])).toEqual([]);
      expect(await checkUploadIntents(U2, [photoA])).toEqual([photoA]);

      // 4. Retry creation succeeds with the restored photoA intent
      const retryDeps = fakeProvisionPhotosDeps();
      const retried = await createCheckIn(
        U2,
        {
          cafe_id: testCafeId,
          scores: { overall: 75, wifi: 80 },
          max_stay: "unlimited",
          note: "Retry after rollback",
          photo_ids: [photoA],
        },
        retryDeps,
      );
      expect(retried.checkin_id).toBeDefined();

      // Check-in committed with photoA
      const checkinRow = await dbClient.query(
        "select photos from checkins where id = $1",
        [retried.checkin_id],
      );
      const attached = checkinRow.rows[0].photos as Array<{ id: string }>;
      expect(attached.some((p) => p.id === photoA)).toBe(true);

      // photoA is now consumed in real Postgres
      expect(await checkUploadIntents(U2, [photoA])).toEqual([]);

      // 5. Replay rejection: reusing consumed photoA fails fast
      await expect(
        createCheckIn(
          U2,
          {
            cafe_id: testCafeId,
            scores: { overall: 80 },
            photo_ids: [photoA],
          },
          retryDeps,
        ),
      ).rejects.toBeInstanceOf(PhotoIntentError);

      await dbClient.query("delete from checkins where cafe_id = $1", [testCafeId]);
      await dbClient.query("delete from cafes where id = $1", [testCafeId]);
    });

    it("batch upload intent consumes multi-photo intents atomically and rejects replay (BRAWUKA-739 / BRAWUKA-791)", async () => {
      const testCafeId = randomUUID();
      await dbClient.query(
        `insert into cafes (id, name, location, city, created_by, tz)
         values ($1, 'Batch Multi Cafe', ST_SetSRID(ST_MakePoint(103.85, 1.3), 4326)::geography,
                 'singapore', $2, 'Asia/Singapore')`,
        [testCafeId, U1],
      );

      const photoC = randomUUID();
      const photoD = randomUUID();
      await recordUploadIntent(U1, photoC);
      await recordUploadIntent(U1, photoD);
      expect(await checkUploadIntents(U1, [photoC, photoD])).toEqual(
        expect.arrayContaining([photoC, photoD]),
      );

      const created = await createCheckIn(
        U1,
        {
          cafe_id: testCafeId,
          scores: { overall: 85, wifi: 90 },
          max_stay: "unlimited",
          note: "Batch consume multi-photo",
          photo_ids: [photoC, photoD],
        },
        fakeProvisionPhotosDeps(),
      );
      expect(created.checkin_id).toBeDefined();

      // Both intents consumed in real Postgres in one batched operation
      expect(await checkUploadIntents(U1, [photoC, photoD])).toEqual([]);

      // Both photos attached to check-in and merged to cafe gallery
      const checkinRes = await dbClient.query("select photos from checkins where id = $1", [created.checkin_id]);
      const photos = checkinRes.rows[0].photos as Array<{ id: string }>;
      expect(photos.some((p) => p.id === photoC)).toBe(true);
      expect(photos.some((p) => p.id === photoD)).toBe(true);

      const cafeRes = await dbClient.query("select gallery from cafes where id = $1", [testCafeId]);
      const gallery = cafeRes.rows[0].gallery as Array<{ id: string }>;
      expect(gallery.some((p) => p.id === photoC)).toBe(true);
      expect(gallery.some((p) => p.id === photoD)).toBe(true);

      // Replaying consumed batch intents throws PhotoIntentError
      await expect(
        createCheckIn(
          U1,
          {
            cafe_id: testCafeId,
            scores: { overall: 80 },
            photo_ids: [photoC, photoD],
          },
          fakeProvisionPhotosDeps(),
        ),
      ).rejects.toBeInstanceOf(PhotoIntentError);

      await dbClient.query("delete from checkins where cafe_id = $1", [testCafeId]);
      await dbClient.query("delete from cafes where id = $1", [testCafeId]);
    });
  });

  describe("opt-in public author identity consent lifecycle (DG139 / #139 Stage 1)", () => {
    it("manages the complete opt-in, handle generation, handle edit, cooldown, and opt-out lifecycle", async () => {
      const userA = randomUUID();
      const userB = randomUUID();

      // Seed profiles
      await dbClient.query(
        "insert into profiles (id, display_name) values ($1, 'Alex Nomad'), ($2, 'Bob Nomad')",
        [userA, userB],
      );

      // 1. Default state: show_public_identity = false, public_handle = null, identity_consented_at = null
      const initial = await dbClient.query(
        "select show_public_identity, public_handle, identity_consented_at, public_handle_changed_at from profiles where id = $1",
        [userA],
      );
      expect(initial.rows[0].show_public_identity).toBe(false);
      expect(initial.rows[0].public_handle).toBeNull();
      expect(initial.rows[0].identity_consented_at).toBeNull();
      expect(initial.rows[0].public_handle_changed_at).toBeNull();

      // 2. Opt-in generates collision-safe handle slug(display_name)-xxxx and stamps identity_consented_at
      const optedIn = await updateProfileIdentity(userA, { showPublicIdentity: true });
      expect(optedIn.showPublicIdentity).toBe(true);
      expect(optedIn.publicHandle).toMatch(/^alex-nomad-[0-9a-f]{4}$/);
      expect(optedIn.identityConsentedAt).not.toBeNull();
      expect(optedIn.publicHandleChangedAt).toBeNull(); // Allows immediate customization!

      // 3. First user customization of server-generated handle is allowed immediately
      const customized = await updateProfileIdentity(userA, {
        showPublicIdentity: true,
        publicHandle: "alex-custom",
      });
      expect(customized.showPublicIdentity).toBe(true);
      expect(customized.publicHandle).toBe("alex-custom");
      expect(customized.publicHandleChangedAt).not.toBeNull();

      // 4. Changing handle again within 7 days is rejected with HandleChangeTooSoonError
      await expect(
        updateProfileIdentity(userA, {
          showPublicIdentity: true,
          publicHandle: "alex-again",
        }),
      ).rejects.toThrow(HandleChangeTooSoonError);

      // 5. Invalid handle format is rejected
      await expect(
        updateProfileIdentity(userA, {
          showPublicIdentity: true,
          publicHandle: "Invalid-Format!",
        }),
      ).rejects.toThrow(InvalidHandleError);

      // 6. Opt-out clears identity_consented_at, sets show_public_identity = false, and retains reserved handle
      const optedOut = await updateProfileIdentity(userA, { showPublicIdentity: false });
      expect(optedOut.showPublicIdentity).toBe(false);
      expect(optedOut.publicHandle).toBe("alex-custom");
      expect(optedOut.identityConsentedAt).toBeNull();

      // Direct DB assertion to verify SQL state
      const dbRow = await dbClient.query(
        "select show_public_identity, public_handle, identity_consented_at from profiles where id = $1",
        [userA],
      );
      expect(dbRow.rows[0].show_public_identity).toBe(false);
      expect(dbRow.rows[0].public_handle).toBe("alex-custom");
      expect(dbRow.rows[0].identity_consented_at).toBeNull();

      // 7. Anti-squatting: another user cannot claim the reserved handle even while User A is opted out
      await expect(
        updateProfileIdentity(userB, {
          showPublicIdentity: true,
          publicHandle: "alex-custom",
        }),
      ).rejects.toThrow(HandleTakenError);

      // 8. Re-opt-in reuses the reserved handle without generating a new one
      const reOptedIn = await updateProfileIdentity(userA, { showPublicIdentity: true });
      expect(reOptedIn.showPublicIdentity).toBe(true);
      expect(reOptedIn.publicHandle).toBe("alex-custom");
      expect(reOptedIn.identityConsentedAt).not.toBeNull();
    });

    it("applies a publicHandle sent in the same request as opt-out (spec 0006)", async () => {
      const userA = randomUUID();
      await dbClient.query(
        "insert into profiles (id, display_name) values ($1, 'Alex Nomad')",
        [userA],
      );
      // Opt-in with an auto-generated handle: public_handle_changed_at stays
      // null, so the first user-chosen edit is permitted immediately.
      const optedIn = await updateProfileIdentity(userA, {
        showPublicIdentity: true,
      });
      expect(optedIn.identityConsentedAt).not.toBeNull();
      expect(optedIn.publicHandleChangedAt).toBeNull();

      // Opt-out carrying a new handle: handle is still validated and applied —
      // handle management is independent of the consent flag.
      const optedOut = await updateProfileIdentity(userA, {
        showPublicIdentity: false,
        publicHandle: "alex-offline",
      });
      expect(optedOut.showPublicIdentity).toBe(false);
      expect(optedOut.publicHandle).toBe("alex-offline");
      expect(optedOut.identityConsentedAt).toBeNull();
      expect(optedOut.publicHandleChangedAt).not.toBeNull();

      const dbRow = await dbClient.query(
        "select show_public_identity, public_handle, identity_consented_at, public_handle_changed_at from profiles where id = $1",
        [userA],
      );
      expect(dbRow.rows[0].show_public_identity).toBe(false);
      expect(dbRow.rows[0].public_handle).toBe("alex-offline");
      expect(dbRow.rows[0].identity_consented_at).toBeNull();
      expect(dbRow.rows[0].public_handle_changed_at).not.toBeNull();
    });

    it("rejects an invalid publicHandle sent with opt-out and leaves consent untouched", async () => {
      const userA = randomUUID();
      await dbClient.query(
        "insert into profiles (id, display_name) values ($1, 'Alex Nomad')",
        [userA],
      );
      await updateProfileIdentity(userA, {
        showPublicIdentity: true,
        publicHandle: "alex-custom",
      });

      await expect(
        updateProfileIdentity(userA, {
          showPublicIdentity: false,
          publicHandle: "Invalid-Format!",
        }),
      ).rejects.toThrow(InvalidHandleError);

      // Validation throws before the write: the opt-out is not applied either.
      const dbRow = await dbClient.query(
        "select show_public_identity, public_handle, identity_consented_at from profiles where id = $1",
        [userA],
      );
      expect(dbRow.rows[0].show_public_identity).toBe(true);
      expect(dbRow.rows[0].public_handle).toBe("alex-custom");
      expect(dbRow.rows[0].identity_consented_at).not.toBeNull();
    });

    it("enforces the 7-day cooldown on a publicHandle sent with opt-out", async () => {
      const userA = randomUUID();
      await dbClient.query(
        "insert into profiles (id, display_name) values ($1, 'Alex Nomad')",
        [userA],
      );
      // User-chosen handle stamps public_handle_changed_at; a second change
      // inside 7 days is rejected even when the request also opts out.
      await updateProfileIdentity(userA, {
        showPublicIdentity: true,
        publicHandle: "alex-custom",
      });

      await expect(
        updateProfileIdentity(userA, {
          showPublicIdentity: false,
          publicHandle: "alex-offline",
        }),
      ).rejects.toThrow(HandleChangeTooSoonError);

      const dbRow = await dbClient.query(
        "select show_public_identity, public_handle, identity_consented_at from profiles where id = $1",
        [userA],
      );
      expect(dbRow.rows[0].show_public_identity).toBe(true);
      expect(dbRow.rows[0].public_handle).toBe("alex-custom");
      expect(dbRow.rows[0].identity_consented_at).not.toBeNull();
    });
  });
});
